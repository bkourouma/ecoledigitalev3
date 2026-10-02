/**
 * Briques partagées par les cas d'usage d'appel (`sessions.ts`) et de synchronisation (`sync.ts`) :
 * contrôle « qui peut faire l'appel », contexte d'une séance (statuts, politique, roster), application d'un lot de
 * pointages (statut, minutes, excuse déjà couverte, écriture, événements d'absence / retard, recalcul).
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { Tx } from "@ecoledigitale/database";
import { AttendanceCode, forbidden, validation } from "../domain/errors";
import { AttendanceEvents } from "../domain/events";
import { prepareMarks, withCoverage, type FinalMark, type MarkContext, type MarkEntryInput } from "../domain/records";
import { selectPolicy } from "../domain/session";
import { indexStatuses } from "../domain/status";
import type { AttendanceSession, CallPolicy, RecordSource, StatusIndex, StudentRecord, Uuid } from "../domain/types";
import { listCallPolicies, listStatuses } from "../infrastructure/reference-repository";
import {
  findCoveringJustifications,
  getRecordsByEnrollments,
  linkCoverage,
  listRecords,
  pruneStaleCoverage,
  upsertRecords,
  type RecordWrite,
  type UpsertOutcome,
} from "../infrastructure/sessions-repository";
import { EventBuffer, type AttendanceDeps, type CallerCaps } from "./deps";
import type { OccurrenceInfo, RosterEntry } from "./ports";
import { recomputeAffected } from "./summaries";

/** Source tracée d'un pointage saisi à la main : la direction (`manage`) agit en `ADMIN`, l'enseignant en `TEACHER`. */
export const humanSourceOf = (caps: CallerCaps): RecordSource => (caps.manage ? "ADMIN" : "TEACHER");

/** Les actions internes (consommateurs, jobs) tournent avec un contexte `system` : elles ne portent pas de droits d'utilisateur. */
export const isSystem = (ctx: RequestContext): boolean => ctx.actor === "system";

export interface TakerTarget {
  readonly classroomId: Uuid;
  readonly takenByStaffId: Uuid | null;
  readonly occurrence?: OccurrenceInfo | null | undefined;
}

/**
 * Qui peut faire l'appel : la direction (`attendance.manage`), le remplaçant désigné (`takenByStaffId`), un
 * intervenant de l'occurrence ou un membre du personnel affecté à la classe. Un utilisateur sans profil de personnel
 * n'a AUCUN droit d'enseignant (le legacy laissait tout enseignant agir sur toute séance).
 */
export async function assertCanTakeCall(deps: AttendanceDeps, ctx: RequestContext, caps: CallerCaps, target: TakerTarget): Promise<Result<{ staffId: Uuid | null }, AppError>> {
  if (isSystem(ctx)) return ok({ staffId: null });
  const staffId = ctx.userId ? await deps.ports.people.getStaffIdForUser(ctx, ctx.userId) : null;
  if (caps.manage) return ok({ staffId });
  const denied = (): Result<never, AppError> =>
    err(forbidden(AttendanceCode.NOT_CALL_TAKER, "Vous n'êtes pas intervenant de cette séance ni affecté à cette classe : l'appel est réservé."));
  if (!staffId) return denied();
  if (target.takenByStaffId === staffId) return ok({ staffId });
  if (target.occurrence?.staff.some((s) => s.staffId === staffId)) return ok({ staffId });
  if (await deps.ports.people.isStaffAssignedToClassroom(ctx, staffId, target.classroomId)) return ok({ staffId });
  return denied();
}

export interface SessionContext {
  readonly defs: StatusIndex;
  readonly policy: CallPolicy | null;
  readonly roster: readonly RosterEntry[];
  readonly markCtx: MarkContext;
}

/** Contexte d'écriture d'une séance : statuts élèves, politique d'appel du niveau, roster à la date de la séance. */
export async function loadSessionContext(deps: AttendanceDeps, ctx: RequestContext, tx: Tx, session: AttendanceSession): Promise<SessionContext> {
  // SÉQUENTIEL : chaque appel de port académique ouvre un SAVEPOINT sur la connexion partagée de la transaction ; deux appels
  // entrelacés (Promise.all) libèrent des points de sauvegarde qui n'existent plus (`savepoint "ed_sp_n" does not exist`).
  const defs = await listStatuses(tx, "STUDENT");
  const policies = await listCallPolicies(tx);
  const classroom = await deps.ports.roster.getClassroom(ctx, session.classroomId);
  const roster = await deps.ports.roster.getRoster(ctx, {
    classroomId: session.classroomId,
    onDate: session.sessionDate,
    curriculumNodeId: session.curriculumNodeId,
    offeringId: session.offeringId,
  });
  const policy = selectPolicy(policies, session.institutionId, classroom?.educationLevelCode ?? null);
  return {
    defs: indexStatuses(defs, "STUDENT"),
    policy,
    roster,
    markCtx: {
      scope: session.scope,
      durationMinutes: session.durationMinutes,
      endsAt: session.endsAt,
      dailyMinutes: policy?.dailyMinutes ?? null,
      lateRequiresMinutes: policy?.lateRequiresMinutes ?? false,
    },
  };
}

export interface ClientMeta {
  readonly clientId: Uuid;
  readonly clientMarkedAt: Date | null;
}

export interface ApplyMarksParams {
  readonly session: AttendanceSession;
  readonly entries: readonly MarkEntryInput[];
  readonly context: SessionContext;
  readonly source: RecordSource;
  /** Métadonnées de synchronisation par élève (clé d'idempotence appareil, horodatage appareil). */
  readonly clientMeta?: ReadonlyMap<Uuid, ClientMeta> | undefined;
}

export interface ApplyMarksResult {
  readonly outcome: UpsertOutcome;
  readonly records: StudentRecord[];
}

const enrollmentByStudent = (roster: readonly RosterEntry[]): Map<Uuid, Uuid> => new Map(roster.map((r) => [r.studentId, r.enrollmentId]));

/**
 * Applique un lot de pointages sur une séance DÉJÀ verrouillée et contrôlée (statut, fenêtre, droits) :
 *  - l'élève doit figurer au roster à la date de la séance (R10) ;
 *  - statut connu / actif, `EXCUSED` refusé en saisie directe, minutes comptées (R7) ;
 *  - une excuse déjà acceptée qui couvre la date s'applique d'emblée (AC3.5) ;
 *  - écriture en une requête (dernier arrivé gagne), historique par déclencheur ;
 *  - séance déjà SUBMITTED : correction => événements d'absence / retard avec `correction: true` et recalcul des récapitulatifs.
 */
export async function applyMarks(deps: AttendanceDeps, ctx: RequestContext, tx: Tx, events: EventBuffer, p: ApplyMarksParams): Promise<Result<ApplyMarksResult, AppError>> {
  const { session, context } = p;
  const byStudent = enrollmentByStudent(context.roster);
  for (const e of p.entries) {
    if (!byStudent.has(e.studentId)) {
      return err(validation(AttendanceCode.STUDENT_NOT_IN_ROSTER, "Cet élève ne figure pas dans la liste d'appel de la séance.", "entries", { studentId: e.studentId }));
    }
  }
  const prepared = prepareMarks(p.entries, context.defs, context.markCtx);
  if (!prepared.ok) return prepared;

  const covering = await findCoveringJustifications(tx, prepared.value.map((m) => m.studentId), session.sessionDate);
  const actor = ctx.userId;
  if (!actor) return err(forbidden(AttendanceCode.FORBIDDEN, "Un appel est saisi par un utilisateur identifié."));

  const writes: RecordWrite[] = prepared.value.map((m): RecordWrite => {
    const final: FinalMark = withCoverage(m, context.defs.get(m.statusCode), covering.get(m.studentId) ?? null);
    const meta = p.clientMeta?.get(m.studentId);
    return {
      ...final,
      id: deps.newId(),
      enrollmentId: byStudent.get(m.studentId) as Uuid,
      markedBy: actor,
      sourceDetail: p.source,
      clientId: meta?.clientId ?? null,
      clientMarkedAt: meta?.clientMarkedAt ?? null,
    };
  });

  const outcome = await upsertRecords(tx, ctx.tenantId, session.id, writes, deps.clock.now());
  await pruneStaleCoverage(tx, session.id);
  await linkCoverage(tx, ctx.tenantId, session.id);

  const touchedEnrollments = [...outcome.created, ...outcome.updated].map((r) => r.enrollmentId);
  const records = await getRecordsByEnrollments(tx, session.id, writes.map((w) => w.enrollmentId));

  if (session.status === "SUBMITTED") {
    // Correction d'un appel déjà soumis : republier les absences / retards modifiés et recalculer les récapitulatifs.
    const changed = new Set(touchedEnrollments);
    emitRecordEvents(events, session, context.defs, records.filter((r) => changed.has(r.enrollmentId)), true);
    await recomputeAffected(deps, ctx, tx, events, {
      enrollmentIds: touchedEnrollments, academicYearId: session.academicYearId, dates: [session.sessionDate], cause: "SESSION_CORRECTED",
    });
  }
  return ok({ outcome, records });
}

/** `attendance.absence.recorded` / `attendance.late.recorded` : une fois par pointage concerné (jamais de motif ni de pièce). */
export function emitRecordEvents(events: EventBuffer, session: AttendanceSession, defs: StatusIndex, records: readonly StudentRecord[], correction: boolean): number {
  let n = 0;
  for (const r of records) {
    const def = defs.get(r.statusCode);
    if (!def) continue;
    const base = {
      v: 1 as const,
      sessionId: session.id,
      recordId: r.id,
      enrollmentId: r.enrollmentId,
      studentId: r.studentId,
      classroomId: session.classroomId,
      date: session.sessionDate,
      occurrenceId: session.occurrenceId,
      statusCode: r.statusCode,
      excused: r.excused,
      correction,
    };
    if (def.countsAsAbsence) {
      events.add(AttendanceEvents.ABSENCE_RECORDED, { ...base, countedMinutes: r.countedMinutes }, { type: "student_record", id: r.id });
      n += 1;
    } else if (def.countsAsLate) {
      events.add(AttendanceEvents.LATE_RECORDED, { ...base, minutesLate: r.minutesLate }, { type: "student_record", id: r.id });
      n += 1;
    }
  }
  return n;
}

export async function recordsOf(tx: Tx, sessionId: Uuid): Promise<StudentRecord[]> {
  return listRecords(tx, sessionId);
}
