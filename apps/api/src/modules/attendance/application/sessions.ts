/**
 * Séances d'appel : un SEUL modèle pour l'appel journalier du primaire, l'appel par séance du secondaire et du
 * supérieur (offre à la carte comprise).
 *
 * Cycle : OPEN -> SUBMITTED -> VALIDATED ; annulation motivée ; réouverture d'une séance validée = acte SENSIBLE
 * (permission dédiée + MFA + audit + réglage de transaction qui lève le verrou de la base).
 *
 * Concurrence : deux enseignants sur la même séance obtiennent la MÊME séance d'appel (unicité par occurrence) ;
 * le marquage prend un verrou partagé sur la séance, la soumission / validation / annulation un verrou exclusif.
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { Tx } from "@ecoledigitale/database";
import { AttendanceCode, conflict, forbidden, notFound, validation } from "../domain/errors";
import { AttendanceEvents } from "../domain/events";
import { prepareMark, withCoverage, type MarkEntryInput } from "../domain/records";
import { callScopeAllows, checkEditable, durationOf, resolveDayPart, selectPolicy } from "../domain/session";
import type { AttendanceSession, DayPart, IsoDate, SessionScope, SessionSource, StudentRecord, Uuid } from "../domain/types";
import { listCallPolicies, listStatuses } from "../infrastructure/reference-repository";
import {
  findCoveringJustifications,
  findDailySession,
  findOverlappingDailySessions,
  findSessionByClientId,
  findSessionByOccurrence,
  getRecord,
  getSession,
  insertSessionIfAbsent,
  linkCoverage,
  listAbsences,
  listRecordHistory,
  listRecords,
  listSessions,
  setReopenAllowed,
  updateSession,
  upsertRecords,
  type AbsenceRow,
  type HistoryRow,
  type RecordWrite,
  type SessionFilter,
} from "../infrastructure/sessions-repository";
import { EventBuffer, actorOf, inTx, type AttendanceDeps, type CallerCaps } from "./deps";
import type { ClassroomInfo, OccurrenceInfo, RosterEntry } from "./ports";
import { ensureReferenceData } from "./reference";
import {
  applyMarks,
  assertCanTakeCall,
  emitRecordEvents,
  humanSourceOf,
  isSystem,
  loadSessionContext,
  type SessionContext,
} from "./session-support";
import { recomputeAffected } from "./summaries";

// ---------------------------------------------------------------------------
// Ouverture (idempotente)
// ---------------------------------------------------------------------------

export type OpenSessionInput =
  | { readonly kind: "occurrence"; readonly occurrenceId: Uuid; readonly clientId?: Uuid | undefined; readonly caps?: CallerCaps }
  | {
      readonly kind: "daily";
      readonly classroomId: Uuid;
      readonly date: IsoDate;
      /** Demi-journée (Q-P17) : obligatoire quand la politique du cycle demande deux appels par jour (`HALF_DAYS`), `FULL` ou omise sinon. */
      readonly dayPart?: DayPart | undefined;
      readonly takenByStaffId?: Uuid | undefined;
      readonly clientId?: Uuid | undefined;
      readonly caps?: CallerCaps;
    }
  | {
      readonly kind: "external";
      readonly classroomId: Uuid;
      readonly date: IsoDate;
      readonly curriculumNodeId: Uuid;
      readonly offeringId?: Uuid | undefined;
      readonly source: "LIVE_CLASS" | "IMPORT";
      readonly startsAt?: Date | undefined;
      readonly endsAt?: Date | undefined;
      readonly durationMinutes?: number | undefined;
      readonly caps?: CallerCaps;
    };

export interface OpenSessionResult {
  readonly session: AttendanceSession;
  readonly created: boolean;
}

/** Variante interne utilisable dans une transaction existante (synchronisation hors-ligne). */
export async function openSessionInTx(
  deps: AttendanceDeps,
  ctx: RequestContext,
  tx: Tx,
  events: EventBuffer,
  input: OpenSessionInput,
  extra: { source?: SessionSource; clientId?: Uuid | undefined } = {},
): Promise<Result<OpenSessionResult, AppError>> {
  const caps = input.caps ?? {};
  const actor = actorOf(ctx);
  if (!actor && !isSystem(ctx)) return err(forbidden(AttendanceCode.FORBIDDEN, "Un appel est ouvert par un utilisateur identifié."));

  let occurrence: OccurrenceInfo | null = null;
  let classroom: ClassroomInfo | null = null;
  let classroomId: Uuid;
  let institutionId: Uuid;
  let academicYearId: Uuid;
  let date: IsoDate;
  let scope: SessionScope;
  let dayPart: DayPart = "FULL";
  let curriculumNodeId: Uuid | null = null;
  let offeringId: Uuid | null = null;
  let startsAt: Date | null = null;
  let endsAt: Date | null = null;
  let duration: number | null = null;
  let source: SessionSource = extra.source ?? "MANUAL";

  if (input.kind === "occurrence") {
    occurrence = await deps.ports.occurrences.getOccurrence(ctx, input.occurrenceId);
    if (!occurrence) return err(notFound(AttendanceCode.OCCURRENCE_NOT_FOUND, "Séance planifiée", input.occurrenceId));
    if (occurrence.status === "CANCELLED") {
      return err(conflict(AttendanceCode.OCCURRENCE_CANCELLED, "La séance planifiée est annulée : l'appel ne peut pas être ouvert.", { occurrenceId: input.occurrenceId }));
    }
    classroomId = occurrence.classroomId;
    classroom = await deps.ports.roster.getClassroom(ctx, classroomId);
    institutionId = occurrence.institutionId;
    academicYearId = occurrence.academicYearId;
    date = occurrence.date;
    scope = "SESSION";
    curriculumNodeId = occurrence.curriculumNodeId;
    offeringId = occurrence.offeringId;
    startsAt = occurrence.startsAt;
    endsAt = occurrence.endsAt;
    duration = durationOf(occurrence.startsAt, occurrence.endsAt, occurrence.durationMinutes);
  } else {
    classroom = await deps.ports.roster.getClassroom(ctx, input.classroomId);
    if (!classroom || !classroom.active) return err(notFound(AttendanceCode.CLASSROOM_NOT_FOUND, "Classe active", input.classroomId));
    classroomId = classroom.classroomId;
    institutionId = classroom.institutionId;
    academicYearId = classroom.academicYearId;
    date = input.date;
    if (input.kind === "daily") {
      scope = "DAILY";
    } else {
      if (!caps.manage && !isSystem(ctx)) {
        return err(forbidden(AttendanceCode.EXTERNAL_SESSION_FORBIDDEN, "Un appel sans séance planifiée est réservé à la direction (sources externes)."));
      }
      scope = "SESSION";
      curriculumNodeId = input.curriculumNodeId;
      offeringId = input.offeringId ?? null;
      startsAt = input.startsAt ?? null;
      endsAt = input.endsAt ?? null;
      duration = durationOf(startsAt, endsAt, input.durationMinutes ?? null);
      source = input.source;
    }
  }

  await ensureReferenceData(deps, ctx, tx, [institutionId]);

  // Politique d'appel du cycle : appel journalier, par séance, ou les deux.
  const policy = selectPolicy(await listCallPolicies(tx), institutionId, classroom?.educationLevelCode ?? null);
  if (policy && !callScopeAllows(policy.callScope, scope)) {
    return err(
      conflict(AttendanceCode.CALL_SCOPE_NOT_ALLOWED, `La politique d'appel de ce cycle n'autorise pas l'appel ${scope === "DAILY" ? "journalier" : "par séance"}.`, {
        callScope: policy.callScope,
        requested: scope,
      }),
    );
  }

  // Appel journalier : la politique du cycle fixe s'il y a un appel par jour ou deux (matin et après-midi, Q-P17).
  if (input.kind === "daily") {
    const resolved = resolveDayPart(policy, input.dayPart);
    if (!resolved.ok) return resolved;
    dayPart = resolved.value;
  }

  // Existe-t-il déjà un appel pour cette occurrence / cette demi-journée ? (idempotence : le second enseignant reçoit le même)
  const existing =
    input.kind === "occurrence"
      ? await findSessionByOccurrence(tx, input.occurrenceId)
      : scope === "DAILY"
        ? await findDailySession(tx, classroomId, date, dayPart)
        : null;

  let takenByStaffId: Uuid | null = null;
  const auth = await assertCanTakeCall(deps, ctx, caps, { classroomId, takenByStaffId: existing?.takenByStaffId ?? null, occurrence });
  if (!auth.ok) return auth;
  takenByStaffId = auth.value.staffId;
  if (input.kind === "daily" && input.takenByStaffId) {
    if (!caps.manage && !isSystem(ctx)) {
      return err(forbidden(AttendanceCode.FORBIDDEN, "Désigner un remplaçant occasionnel est réservé à la direction."));
    }
    const staff = await deps.ports.people.getStaffById(ctx, input.takenByStaffId);
    if (!staff || !staff.active) return err(notFound(AttendanceCode.STAFF_NOT_FOUND, "Membre du personnel actif", input.takenByStaffId));
    takenByStaffId = input.takenByStaffId;
  }
  if (existing) return ok({ session: existing, created: false });
  if (scope === "DAILY") {
    // Un appel de la journée entière recouvre le matin et l'après-midi (et inversement) : jamais deux appels pour la même demi-journée.
    const overlapping = await findOverlappingDailySessions(tx, classroomId, date, dayPart);
    if (overlapping.length > 0) {
      return err(
        conflict(AttendanceCode.DAY_PART_TAKEN, "Un autre appel de cette classe couvre déjà cette demi-journée : annulez-le ou continuez-le avant d'en ouvrir un nouveau.", {
          dayPart,
          existing: overlapping.map((o) => ({ sessionId: o.id, dayPart: o.dayPart, status: o.status })),
        }),
      );
    }
  }

  const clientId = extra.clientId ?? ("clientId" in input ? input.clientId : undefined) ?? null;
  const inserted = await insertSessionIfAbsent(tx, {
    id: deps.newId(), tenantId: ctx.tenantId, institutionId, academicYearId, classroomId, curriculumNodeId, offeringId,
    occurrenceId: occurrence?.occurrenceId ?? null, scope, dayPart, sessionDate: date, startsAt, endsAt, durationMinutes: duration,
    takenByStaffId, takenByUserId: actor, source, clientId,
  });
  if (!inserted) {
    // Course perdue (deux appareils ou deux enseignants) : on renvoie la séance gagnante.
    const winner =
      (occurrence ? await findSessionByOccurrence(tx, occurrence.occurrenceId) : scope === "DAILY" ? await findDailySession(tx, classroomId, date, dayPart) : null) ??
      (clientId ? await findSessionByClientId(tx, clientId) : null);
    if (!winner) {
      return err(conflict(AttendanceCode.IDEMPOTENCY_KEY_REUSED, "Cette clé d'idempotence correspond déjà à une autre séance.", { clientId }));
    }
    return ok({ session: winner, created: false });
  }
  events.add(
    AttendanceEvents.SESSION_OPENED,
    { v: 1, sessionId: inserted.id, classroomId, date, scope, dayPart: inserted.dayPart, occurrenceId: inserted.occurrenceId, source },
    { type: "attendance_session", id: inserted.id },
  );
  return ok({ session: inserted, created: true });
}

/**
 * `openAttendanceSession` : ouvre l'appel d'une occurrence (ou d'une classe et d'un jour pour l'appel journalier) ou
 * renvoie l'appel EXISTANT. Idempotent. Refuse si l'occurrence est annulée, si la politique d'appel du cycle ne
 * l'autorise pas, ou si l'appelant n'est ni intervenant de la séance ni affecté à la classe (sauf `attendance.manage`).
 */
export async function openAttendanceSession(deps: AttendanceDeps, ctx: RequestContext, input: OpenSessionInput): Promise<Result<OpenSessionResult, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const events = new EventBuffer(deps, ctx);
    const result = await openSessionInTx(deps, ctx, tx, events, input);
    if (!result.ok) return result;
    await events.flush(tx);
    return result;
  });
}

// ---------------------------------------------------------------------------
// Lectures
// ---------------------------------------------------------------------------

export interface SessionDetail {
  readonly session: AttendanceSession;
  readonly students: ReadonlyArray<{ enrollmentId: Uuid; studentId: Uuid; displayName: string | null; inRoster: boolean; record: StudentRecord | null }>;
  readonly counts: { rosterSize: number; marked: number; unmarked: number; absent: number; late: number };
  readonly editable: boolean;
}

export async function getAttendanceSession(deps: AttendanceDeps, ctx: RequestContext, input: { sessionId: Uuid; caps?: CallerCaps }): Promise<Result<SessionDetail, AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const session = await getSession(tx, input.sessionId);
      if (!session) return err(notFound(AttendanceCode.SESSION_NOT_FOUND, "Appel", input.sessionId));
      const [records, defsRows] = await Promise.all([listRecords(tx, session.id), listStatuses(tx, "STUDENT")]);
      let context: SessionContext | null = null;
      try {
        context = await loadSessionContext(deps, ctx, tx, session);
      } catch (e) {
        if (!(e instanceof Error) || (e as { code?: string }).code !== AttendanceCode.PORT_UNAVAILABLE) throw e;
      }
      const roster: readonly RosterEntry[] = context?.roster ?? [];
      const byEnrollment = new Map(records.map((r) => [r.enrollmentId, r]));
      const students: Array<SessionDetail["students"][number]> = roster.map((r) => ({
        enrollmentId: r.enrollmentId, studentId: r.studentId, displayName: r.displayName ?? null, inRoster: true, record: byEnrollment.get(r.enrollmentId) ?? null,
      }));
      const inRoster = new Set(roster.map((r) => r.enrollmentId));
      for (const rec of records) {
        if (!inRoster.has(rec.enrollmentId)) students.push({ enrollmentId: rec.enrollmentId, studentId: rec.studentId, displayName: null, inRoster: false, record: rec });
      }
      const defs = new Map(defsRows.map((d) => [d.code, d]));
      const marked = students.filter((s) => s.inRoster && s.record).length;
      const editable = checkEditable(session, context?.policy ?? null, { now: deps.clock.now(), canManage: input.caps?.manage === true }).ok;
      return ok({
        session,
        students,
        counts: {
          rosterSize: roster.length,
          marked,
          unmarked: roster.length - marked,
          absent: records.filter((r) => defs.get(r.statusCode)?.countsAsAbsence === true).length,
          late: records.filter((r) => defs.get(r.statusCode)?.countsAsLate === true).length,
        },
        editable,
      });
    },
    { readOnly: true },
  );
}

export async function listAttendanceSessions(deps: AttendanceDeps, ctx: RequestContext, filter: SessionFilter): Promise<Result<{ items: AttendanceSession[]; nextCursor: string | null }, AppError>> {
  return inTx(deps, ctx, async (tx) => ok(await listSessions(tx, filter)), { readOnly: true });
}

export async function getRecordHistory(deps: AttendanceDeps, ctx: RequestContext, input: { sessionId: Uuid; recordId: Uuid }): Promise<Result<HistoryRow[], AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const record = await getRecord(tx, input.recordId);
      if (!record || record.sessionId !== input.sessionId) return err(notFound(AttendanceCode.RECORD_NOT_FOUND, "Pointage", input.recordId));
      return ok(await listRecordHistory(tx, record.id));
    },
    { readOnly: true },
  );
}

/** Absences, retards et départs anticipés d'un élève (fiche d'absences, portails). */
export async function listStudentRecords(
  deps: AttendanceDeps,
  ctx: RequestContext,
  input: { studentId: Uuid; from?: IsoDate | undefined; to?: IsoDate | undefined; limit?: number | undefined; cursor?: string | undefined },
): Promise<Result<{ items: AbsenceRow[]; nextCursor: string | null }, AppError>> {
  return inTx(deps, ctx, async (tx) => ok(await listAbsences(tx, input)), { readOnly: true });
}

// ---------------------------------------------------------------------------
// Marquage en lot
// ---------------------------------------------------------------------------

export interface MarkRecordsInput {
  readonly sessionId: Uuid;
  readonly entries: readonly MarkEntryInput[];
  readonly caps?: CallerCaps;
}

export interface MarkRecordsResult {
  readonly session: AttendanceSession;
  readonly created: number;
  readonly updated: number;
  readonly unchanged: number;
  readonly records: StudentRecord[];
}

/**
 * `markStudentRecords` : enregistre un lot de pointages. IDEMPOTENT (rejouer le même lot ne change rien) ; dernier
 * arrivé gagne par élève tant que la séance est modifiable ; tout le lot est refusé si une entrée est invalide.
 */
export async function markStudentRecords(deps: AttendanceDeps, ctx: RequestContext, input: MarkRecordsInput): Promise<Result<MarkRecordsResult, AppError>> {
  const caps = input.caps ?? {};
  return inTx(deps, ctx, async (tx) => {
    const events = new EventBuffer(deps, ctx);
    const session = await getSession(tx, input.sessionId, "SHARE");
    if (!session) return err(notFound(AttendanceCode.SESSION_NOT_FOUND, "Appel", input.sessionId));
    const auth = await assertCanTakeCall(deps, ctx, caps, { classroomId: session.classroomId, takenByStaffId: session.takenByStaffId, occurrence: await occurrenceOf(deps, ctx, session) });
    if (!auth.ok) return auth;
    const context = await loadSessionContext(deps, ctx, tx, session);
    const editable = checkEditable(session, context.policy, { now: deps.clock.now(), canManage: caps.manage === true });
    if (!editable.ok) return editable;

    const applied = await applyMarks(deps, ctx, tx, events, { session, entries: input.entries, context, source: humanSourceOf(caps) });
    if (!applied.ok) return applied;
    await events.flush(tx);
    const { outcome, records } = applied.value;
    return ok({ session, created: outcome.created.length, updated: outcome.updated.length, unchanged: outcome.unchanged.length, records });
  });
}

async function occurrenceOf(deps: AttendanceDeps, ctx: RequestContext, session: AttendanceSession): Promise<OccurrenceInfo | null> {
  if (!session.occurrenceId || isSystem(ctx)) return null;
  return deps.ports.occurrences.getOccurrence(ctx, session.occurrenceId);
}

// ---------------------------------------------------------------------------
// Soumission
// ---------------------------------------------------------------------------

export interface SubmitSessionInput {
  readonly sessionId: Uuid;
  /** Statut donné aux non-marqués (« tous présents sauf »). Obligatoire s'il en reste. */
  readonly defaultStatus?: string | undefined;
  readonly allPresent?: boolean | undefined;
  readonly caps?: CallerCaps;
}

export interface SubmitSessionResult {
  readonly session: AttendanceSession;
  readonly alreadySubmitted: boolean;
  readonly filledByDefault: number;
  readonly absentCount: number;
  readonly lateCount: number;
}

/** Soumission interne, dans une transaction existante (réutilisée par la synchronisation hors-ligne). */
export async function submitSessionInTx(
  deps: AttendanceDeps,
  ctx: RequestContext,
  tx: Tx,
  events: EventBuffer,
  input: SubmitSessionInput,
): Promise<Result<SubmitSessionResult, AppError>> {
  const caps = input.caps ?? {};
  const session = await getSession(tx, input.sessionId, "UPDATE");
  if (!session) return err(notFound(AttendanceCode.SESSION_NOT_FOUND, "Appel", input.sessionId));
  const auth = await assertCanTakeCall(deps, ctx, caps, { classroomId: session.classroomId, takenByStaffId: session.takenByStaffId, occurrence: await occurrenceOf(deps, ctx, session) });
  if (!auth.ok) return auth;
  if (session.status === "SUBMITTED" || session.status === "VALIDATED") {
    return ok({ session, alreadySubmitted: true, filledByDefault: 0, absentCount: 0, lateCount: 0 });
  }
  if (session.status === "CANCELLED") return err(conflict(AttendanceCode.SESSION_LOCKED, "L'appel est annulé.", { status: session.status }));

  const context = await loadSessionContext(deps, ctx, tx, session);
  const actor = actorOf(ctx);
  if (!actor) return err(forbidden(AttendanceCode.FORBIDDEN, "La soumission d'un appel exige un utilisateur identifié."));

  const existing = await listRecords(tx, session.id);
  const marked = new Set(existing.map((r) => r.enrollmentId));
  const unmarked = context.roster.filter((r) => !marked.has(r.enrollmentId));
  const defaultStatus = input.defaultStatus ?? (input.allPresent ? "PRESENT" : undefined);

  if (unmarked.length > 0) {
    if (!defaultStatus) {
      return err(
        validation(AttendanceCode.UNMARKED_STUDENTS, `${unmarked.length} élève(s) n'ont pas été pointés : précisez le statut par défaut (« tous présents sauf »).`, "defaultStatus", {
          studentIds: unmarked.map((u) => u.studentId),
          count: unmarked.length,
        }),
      );
    }
    const covering = await findCoveringJustifications(tx, unmarked.map((u) => u.studentId), session.sessionDate);
    const writes: RecordWrite[] = [];
    for (const u of unmarked) {
      const prepared = prepareMark({ studentId: u.studentId, statusCode: defaultStatus }, context.defs, context.markCtx);
      if (!prepared.ok) return prepared;
      writes.push({
        ...withCoverage(prepared.value, context.defs.get(defaultStatus), covering.get(u.studentId) ?? null),
        id: deps.newId(), enrollmentId: u.enrollmentId, markedBy: actor, sourceDetail: humanSourceOf(caps), clientId: null, clientMarkedAt: null,
      });
    }
    await upsertRecords(tx, ctx.tenantId, session.id, writes, deps.clock.now());
    await linkCoverage(tx, ctx.tenantId, session.id);
  }

  const submitted = await updateSession(tx, session.id, {
    status: "SUBMITTED", submittedAt: deps.clock.now(), takenByUserId: session.takenByUserId ?? actor, takenByStaffId: session.takenByStaffId ?? auth.value.staffId,
  });
  const records = await listRecords(tx, session.id);
  emitRecordEvents(events, submitted, context.defs, records, false);
  const absentCount = records.filter((r) => context.defs.get(r.statusCode)?.countsAsAbsence === true).length;
  const lateCount = records.filter((r) => context.defs.get(r.statusCode)?.countsAsLate === true).length;
  events.add(
    AttendanceEvents.SESSION_SUBMITTED,
    {
      v: 1, sessionId: submitted.id, classroomId: submitted.classroomId, date: submitted.sessionDate, scope: submitted.scope, occurrenceId: submitted.occurrenceId,
      curriculumNodeId: submitted.curriculumNodeId, takenByStaffId: submitted.takenByStaffId, absentCount, lateCount, recordCount: records.length,
    },
    { type: "attendance_session", id: submitted.id },
  );
  await recomputeAffected(deps, ctx, tx, events, {
    enrollmentIds: records.map((r) => r.enrollmentId), academicYearId: submitted.academicYearId, dates: [submitted.sessionDate], cause: "SESSION_SUBMITTED",
  });
  return ok({ session: submitted, alreadySubmitted: false, filledByDefault: unmarked.length, absentCount, lateCount });
}

/**
 * `submitAttendanceSession` : exige que chaque élève du roster ait un pointage ; les non-marqués reçoivent le statut par
 * défaut (« tous présents sauf »). Passe la séance en SUBMITTED, publie `attendance.session.submitted` (017 : HELD) et
 * `absence.recorded` / `late.recorded` UNE fois par pointage concerné. Idempotent.
 */
export async function submitAttendanceSession(deps: AttendanceDeps, ctx: RequestContext, input: SubmitSessionInput): Promise<Result<SubmitSessionResult, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const events = new EventBuffer(deps, ctx);
    const result = await submitSessionInTx(deps, ctx, tx, events, input);
    if (!result.ok) return result;
    await events.flush(tx);
    return result;
  });
}

// ---------------------------------------------------------------------------
// Validation, réouverture, annulation
// ---------------------------------------------------------------------------

/** `validateAttendanceSession` (`attendance.validate`) : fige la séance (plus aucun pointage modifiable). Idempotent. */
export async function validateAttendanceSession(deps: AttendanceDeps, ctx: RequestContext, input: { sessionId: Uuid; caps?: CallerCaps }): Promise<Result<AttendanceSession, AppError>> {
  if (!input.caps?.validate && !isSystem(ctx)) return err(forbidden(AttendanceCode.FORBIDDEN, "Valider un appel exige la permission de validation."));
  const actor = actorOf(ctx);
  if (!actor) return err(forbidden(AttendanceCode.FORBIDDEN, "La validation exige un utilisateur identifié."));
  return inTx(deps, ctx, async (tx) => {
    const events = new EventBuffer(deps, ctx);
    const session = await getSession(tx, input.sessionId, "UPDATE");
    if (!session) return err(notFound(AttendanceCode.SESSION_NOT_FOUND, "Appel", input.sessionId));
    if (session.status === "VALIDATED") return ok(session);
    if (session.status !== "SUBMITTED") {
      return err(conflict(AttendanceCode.INVALID_TRANSITION, `Seul un appel soumis peut être validé (statut actuel : ${session.status}).`, { from: session.status, to: "VALIDATED" }));
    }
    const validated = await updateSession(tx, session.id, { status: "VALIDATED", validatedAt: deps.clock.now(), validatedBy: actor });
    events.add(
      AttendanceEvents.SESSION_VALIDATED,
      { v: 1, sessionId: validated.id, classroomId: validated.classroomId, date: validated.sessionDate, occurrenceId: validated.occurrenceId },
      { type: "attendance_session", id: validated.id },
    );
    await events.flush(tx);
    return ok(validated);
  });
}

const minReason = (reason: string | undefined, field = "reason"): Result<string, AppError> => {
  const r = reason?.trim() ?? "";
  return r.length >= 5 ? ok(r) : err(validation(AttendanceCode.REASON_REQUIRED, "Un motif d'au moins 5 caractères est obligatoire.", field));
};

/**
 * `reopenAttendanceSession` : repasse un appel VALIDÉ en SUBMITTED. Acte SENSIBLE : permission
 * `attendance.session.reopen` (+ MFA vérifiée par la garde de route), motif obligatoire, audit dans la même
 * transaction, compteur `reopened_count`. Sans la capacité, le réglage de transaction qui lève le verrou n'est PAS posé
 * et la base refuse la transition.
 */
export async function reopenAttendanceSession(deps: AttendanceDeps, ctx: RequestContext, input: { sessionId: Uuid; reason: string; caps?: CallerCaps }): Promise<Result<AttendanceSession, AppError>> {
  if (!input.caps?.reopen) return err(forbidden(AttendanceCode.FORBIDDEN, "Rouvrir un appel validé exige la permission dédiée."));
  const reason = minReason(input.reason);
  if (!reason.ok) return reason;
  return inTx(deps, ctx, async (tx) => {
    const events = new EventBuffer(deps, ctx);
    const session = await getSession(tx, input.sessionId, "UPDATE");
    if (!session) return err(notFound(AttendanceCode.SESSION_NOT_FOUND, "Appel", input.sessionId));
    if (session.status !== "VALIDATED") {
      return err(conflict(AttendanceCode.INVALID_TRANSITION, `Seul un appel validé peut être rouvert (statut actuel : ${session.status}).`, { from: session.status, to: "SUBMITTED" }));
    }
    await setReopenAllowed(tx, true);
    const reopened = await updateSession(tx, session.id, { status: "SUBMITTED", incrementReopened: true, note: `Réouverture : ${reason.value}` });
    await setReopenAllowed(tx, false);
    events.add(
      AttendanceEvents.SESSION_REOPENED,
      { v: 1, sessionId: reopened.id, classroomId: reopened.classroomId, date: reopened.sessionDate, occurrenceId: reopened.occurrenceId, reopenedCount: reopened.reopenedCount },
      { type: "attendance_session", id: reopened.id },
    );
    events.audit({
      action: "attendance.session.reopened",
      resourceType: "attendance_session",
      resourceId: reopened.id,
      sensitive: true,
      reason: reason.value,
      before: { status: "VALIDATED", validatedBy: session.validatedBy },
      after: { status: "SUBMITTED", reopenedCount: reopened.reopenedCount },
    });
    await events.flush(tx);
    return ok(reopened);
  });
}

export interface CancelSessionInput {
  readonly sessionId: Uuid;
  readonly reason: string;
  readonly caps?: CallerCaps;
  readonly cause?: "MANUAL" | "OCCURRENCE_CANCELLED";
}

/** Annulation interne (transaction existante). Une séance VALIDÉE exige la capacité de réouverture. */
export async function cancelSessionInTx(deps: AttendanceDeps, ctx: RequestContext, tx: Tx, events: EventBuffer, input: CancelSessionInput): Promise<Result<AttendanceSession, AppError>> {
  const caps = input.caps ?? {};
  const reason = minReason(input.reason);
  if (!reason.ok) return reason;
  const session = await getSession(tx, input.sessionId, "UPDATE");
  if (!session) return err(notFound(AttendanceCode.SESSION_NOT_FOUND, "Appel", input.sessionId));
  if (session.status === "CANCELLED") return ok(session);
  const auth = await assertCanTakeCall(deps, ctx, caps, { classroomId: session.classroomId, takenByStaffId: session.takenByStaffId, occurrence: await occurrenceOf(deps, ctx, session) });
  if (!auth.ok) return auth;
  const system = isSystem(ctx);
  if (session.status === "VALIDATED" && !caps.reopen && !system) {
    return err(forbidden(AttendanceCode.FORBIDDEN, "Annuler un appel validé exige la permission de réouverture (acte sensible)."));
  }
  const wasValidated = session.status === "VALIDATED";
  if (wasValidated) await setReopenAllowed(tx, true);
  const cancelled = await updateSession(tx, session.id, { status: "CANCELLED", note: reason.value });
  if (wasValidated) await setReopenAllowed(tx, false);
  const records = await listRecords(tx, session.id);
  events.add(
    AttendanceEvents.SESSION_CANCELLED,
    { v: 1, sessionId: cancelled.id, classroomId: cancelled.classroomId, date: cancelled.sessionDate, occurrenceId: cancelled.occurrenceId, cause: input.cause ?? "MANUAL" },
    { type: "attendance_session", id: cancelled.id },
  );
  if (session.status !== "OPEN") {
    events.audit({
      action: "attendance.session.cancelled",
      resourceType: "attendance_session",
      resourceId: cancelled.id,
      sensitive: true,
      reason: reason.value,
      before: { status: session.status },
      after: { status: "CANCELLED", cause: input.cause ?? "MANUAL" },
    });
  }
  // Une séance annulée ne produit plus aucune absence : récapitulatifs recalculés.
  await recomputeAffected(deps, ctx, tx, events, { enrollmentIds: records.map((r) => r.enrollmentId), cause: "SESSION_CANCELLED" });
  return ok(cancelled);
}

/** `cancelAttendanceSession` : annulation motivée (jamais de suppression). */
export async function cancelAttendanceSession(deps: AttendanceDeps, ctx: RequestContext, input: CancelSessionInput): Promise<Result<AttendanceSession, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const events = new EventBuffer(deps, ctx);
    const result = await cancelSessionInTx(deps, ctx, tx, events, input);
    if (!result.ok) return result;
    await events.flush(tx);
    return result;
  });
}
