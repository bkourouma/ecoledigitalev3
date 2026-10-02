/**
 * Lectures composées : dossier de vie scolaire d'un élève (personnel, par habilitation), synthèse de classe, tableau de bord,
 * vue famille / élève (UNIQUEMENT ce que la règle SQL `audience_may_see` laisse passer) et faits pour les autres modules.
 *
 *  - Les retards et absences sont une VUE d'`attendance` (port, lecture seule) : jamais copiés ni stockés ici.
 *  - Un GET n'écrit jamais ; la lecture d'un élément confidentiel ne passe que par `readConfidential` (journalisée).
 *  - Famille : hors lien vivant (revérifié à chaque lecture) : 404, jamais 403.
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type {
  SchoolLifeAttendanceViewDto,
  SchoolLifeClassroomSummaryDto,
  SchoolLifeDashboardDto,
  SchoolLifeFamilyItemDto,
  SchoolLifeFamilyLifeDto,
  SchoolLifeStudentLifeDto,
} from "@ecoledigitale/contracts/src/v2/schoollife";
import { forbidden, notFound, SchoolLifeCode } from "../domain/errors";
import * as convocationsRepo from "../infrastructure/convocations-repository";
import * as factsRepo from "../infrastructure/facts-repository";
import * as history from "../infrastructure/history-repository";
import * as incidentsRepo from "../infrastructure/incidents-repository";
import * as measuresRepo from "../infrastructure/measures-repository";
import * as notesRepo from "../infrastructure/notes-repository";
import { conductViewOf } from "./conduct";
import { inTx, todayOf, type CallerCaps, type SchoolLifeDeps } from "./deps";
import { assertStudentScope, loadTypes, studentNames, viewerOf } from "./support";
import { convocationDto, familyConvocationItem, familyMeasureItem, familyNoteItem, incidentDto, measureDto, noteDto } from "./views";

const ABSENCE_VIEW_LIMIT = 100;

async function attendanceViewOf(deps: SchoolLifeDeps, ctx: RequestContext, studentId: string, window: { from?: string | undefined; to?: string | undefined }): Promise<SchoolLifeAttendanceViewDto> {
  try {
    const rows = await deps.ports.attendance.listAbsences(ctx, { studentId, ...(window.from ? { from: window.from } : {}), ...(window.to ? { to: window.to } : {}), limit: ABSENCE_VIEW_LIMIT });
    const late = rows.filter((r) => r.minutesLate !== null);
    return {
      available: true,
      absences: rows.map((r) => ({ recordId: r.recordId, sessionDate: r.sessionDate, statusCode: r.statusCode, excused: r.excused, countedMinutes: r.countedMinutes, minutesLate: r.minutesLate })),
      summary: { absentCount: rows.length - late.length, excusedCount: rows.filter((r) => r.excused).length, lateCount: late.length },
    };
  } catch (e) {
    // Lecture optionnelle : sans le port `attendance`, le dossier reste lisible et l'écran l'indique.
    deps.logger.warn({ err: e }, "schoollife : vue d'assiduité indisponible");
    return { available: false, absences: [], summary: null };
  }
}

export async function getStudentLife(
  deps: SchoolLifeDeps,
  ctx: RequestContext,
  caps: CallerCaps,
  input: { studentId: string; academicYearId?: string | undefined; from?: string | undefined; to?: string | undefined },
): Promise<Result<SchoolLifeStudentLifeDto, AppError>> {
  const scope = await assertStudentScope(deps, ctx, caps, input.studentId);
  if (!scope.ok) return scope;
  const viewer = viewerOf(caps);
  const enrollments = await deps.ports.enrollments.listEnrollmentsOfStudent(ctx, input.studentId);
  const attendance = await attendanceViewOf(deps, ctx, input.studentId, input);
  const names = await studentNames(deps, ctx, [input.studentId]);
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const incidentRows = await incidentsRepo.listIncidents(tx, { audience: viewer.audience, studentId: input.studentId, from: input.from, to: input.to, limit: 200, offset: 0 });
      const measureRows = await measuresRepo.listMeasures(tx, { audience: viewer.audience, studentId: input.studentId, limit: 200, offset: 0 });
      const noteRows = await notesRepo.listNotes(tx, { audience: viewer.audience, studentId: input.studentId, limit: 200, offset: 0 });
      const convocationRows = await convocationsRepo.listConvocations(tx, { audience: viewer.audience, studentId: input.studentId, limit: 200, offset: 0 });
      const involvements = await incidentsRepo.listInvolvements(tx, incidentRows.map((r) => r.id));
      const types = await loadTypes(tx, [...incidentRows.map((r) => r.typeId), ...measureRows.map((r) => r.typeId), ...noteRows.map((r) => r.typeId)]);
      const allNames = new Map([...names, ...(await studentNames(deps, ctx, involvements.map((i) => i.studentId)))]);
      const vc = { types, names: allNames };
      const appeals = await measuresRepo.listAppealsOf(tx, measureRows.map((r) => r.id));
      const visibleIds = new Set([...incidentRows, ...measureRows, ...noteRows, ...convocationRows].map((r) => r.id));
      const events = (await history.listLifeEventsOfStudent(tx, input.studentId, 300)).filter((e) => visibleIds.has(e.entityId) || e.entityKind === "SCALE" || e.entityKind === "APPEAL");
      const actorIds = [...new Set(events.map((e) => e.actorId).filter((a): a is string => a !== null))].slice(0, 30);
      const actorNames = new Map<string, string>();
      for (const id of actorIds) actorNames.set(id, await deps.ports.people.displayNameOfUser(ctx, id).catch(() => "Utilisateur"));
      return ok({
        studentId: input.studentId,
        studentName: names.get(input.studentId) ?? null,
        clearance: viewer.clearance,
        incidents: incidentRows.map((r) => incidentDto(r, involvements, vc, { showStatements: caps.incidentReview === true })),
        measures: measureRows.map((r) => measureDto(r, appeals, vc)),
        notes: noteRows.map((r) => noteDto(r, vc)),
        convocations: convocationRows.map((r) => convocationDto(r, vc)),
        conduct: await conductViewOf(deps, ctx, tx, input.studentId, enrollments, { academicYearId: input.academicYearId }),
        attendance,
        history: events.map((e) => ({
          id: e.id,
          entityKind: e.entityKind,
          entityId: e.entityId,
          action: e.action,
          fromStatus: e.fromStatus,
          toStatus: e.toStatus,
          actorKind: e.actorKind,
          actorName: e.actorId ? (actorNames.get(e.actorId) ?? null) : null,
          reason: e.reason,
          occurredAt: e.occurredAt.toISOString(),
        })),
      });
    },
    { readOnly: true },
  );
}

// ---------------------------------------------------------------------------
// Portails : famille et élève
// ---------------------------------------------------------------------------

/** Tuteur lié (`audience: GUARDIAN`) ou élève lui-même (`STUDENT`). Hors lien : 404. */
export async function getFamilyLife(
  deps: SchoolLifeDeps,
  ctx: RequestContext,
  caps: CallerCaps,
  input: { audience: "GUARDIAN" | "STUDENT"; studentId?: string | undefined },
): Promise<Result<SchoolLifeFamilyLifeDto, AppError>> {
  const userId = ctx.userId;
  if (!userId) return err(forbidden(SchoolLifeCode.HUMAN_ACTOR_REQUIRED, "Identification requise."));
  let studentId: string;
  if (input.audience === "GUARDIAN") {
    if (!caps.childRead) return err(forbidden(SchoolLifeCode.PERMISSION_REQUIRED, "Accès aux enfants non autorisé."));
    if (!input.studentId || !(await deps.ports.people.isGuardianOfStudent(ctx, userId, input.studentId))) return err(notFound(SchoolLifeCode.NOT_FOUND, "Élève", input.studentId));
    studentId = input.studentId;
  } else {
    if (!caps.selfRead) return err(forbidden(SchoolLifeCode.PERMISSION_REQUIRED, "Accès à son dossier non autorisé."));
    const own = await deps.ports.people.getStudentIdForUser(ctx, userId);
    if (!own) return err(notFound(SchoolLifeCode.NOT_FOUND, "Élève"));
    studentId = own;
  }
  const names = await studentNames(deps, ctx, [studentId]);
  const guardians = input.audience === "GUARDIAN" ? await deps.ports.people.listGuardiansOfStudent(ctx, studentId) : [];
  const myGuardianId = guardians.find((g) => g.userId === userId)?.guardianId ?? null;
  return inTx(
    deps,
    ctx,
    async (tx) => {
      // Les lignes arrivent DÉJÀ filtrées par la règle SQL `audience_may_see` (aucune règle de visibilité répliquée ici).
      const measureRows = await measuresRepo.listMeasures(tx, { audience: input.audience, studentId, limit: 200, offset: 0 });
      const noteRows = await notesRepo.listNotes(tx, { audience: input.audience, studentId, limit: 200, offset: 0 });
      const convocationRows = await convocationsRepo.listConvocations(tx, { audience: input.audience, studentId, limit: 200, offset: 0 });
      const types = await loadTypes(tx, [...measureRows.map((r) => r.typeId), ...noteRows.map((r) => r.typeId)]);
      const appeals = await measuresRepo.listAppealsOf(tx, measureRows.map((r) => r.id));
      const items: SchoolLifeFamilyItemDto[] = [
        ...measureRows.map((r) => familyMeasureItem(r, types.get(r.typeId), appeals)),
        ...noteRows.map((r) => familyNoteItem(r, types.get(r.typeId))),
        ...convocationRows.map((r) => familyConvocationItem(r, { canAcknowledge: caps.childAcknowledge === true && myGuardianId !== null && r.guardianIds.includes(myGuardianId) })),
      ];
      return ok({ studentId, studentName: names.get(studentId) ?? null, items });
    },
    { readOnly: true },
  );
}

/** Enfants du tuteur connecté (écran d'accueil du portail parent). */
export async function listMyChildren(deps: SchoolLifeDeps, ctx: RequestContext): Promise<Result<Array<{ studentId: string; studentName: string | null }>, AppError>> {
  if (!ctx.userId) return err(forbidden(SchoolLifeCode.HUMAN_ACTOR_REQUIRED, "Identification requise."));
  const ids = await deps.ports.people.listChildrenOfGuardian(ctx, ctx.userId);
  const names = await studentNames(deps, ctx, ids);
  return ok(ids.map((id) => ({ studentId: id, studentName: names.get(id) ?? null })));
}

// ---------------------------------------------------------------------------
// Synthèse de classe et tableau de bord
// ---------------------------------------------------------------------------

export async function getClassroomSummary(deps: SchoolLifeDeps, ctx: RequestContext, caps: CallerCaps, classroomId: string): Promise<Result<SchoolLifeClassroomSummaryDto, AppError>> {
  const viewer = viewerOf(caps);
  const assigned = ctx.userId ? await deps.ports.people.isStaffAssignedToClassroom(ctx, ctx.userId, classroomId) : false;
  if (!viewer.readAll && !assigned) return err(notFound(SchoolLifeCode.NOT_FOUND, "Classe", classroomId));
  const today = todayOf(deps);
  const roster = await deps.ports.enrollments.getRoster(ctx, classroomId, today);
  const names = await studentNames(deps, ctx, roster.map((r) => r.studentId));
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const counts = new Map((await history.classroomCounts(tx, viewer.audience, roster.map((r) => r.enrollmentId))).map((c) => [c.enrollmentId, c]));
      const excluded = await factsRepo.excludedEnrollmentIds(tx, roster.map((r) => r.enrollmentId), today);
      return ok({
        classroomId,
        students: roster
          .map((r) => {
            const c = counts.get(r.enrollmentId);
            return {
              studentId: r.studentId,
              enrollmentId: r.enrollmentId,
              studentName: names.get(r.studentId) ?? null,
              incidents: c?.incidents ?? 0,
              measures: c?.measures ?? 0,
              warnings: c?.warnings ?? 0,
              encouragements: c?.encouragements ?? 0,
              observations: c?.observations ?? 0,
              excludedToday: excluded.has(r.enrollmentId),
            };
          })
          .sort((a, b) => (a.studentName ?? "").localeCompare(b.studentName ?? "", "fr")),
      });
    },
    { readOnly: true },
  );
}

export async function getDashboard(deps: SchoolLifeDeps, ctx: RequestContext, caps: CallerCaps, input: { institutionId?: string | undefined }): Promise<Result<SchoolLifeDashboardDto, AppError>> {
  const viewer = viewerOf(caps);
  if (!viewer.readAll) return err(forbidden(SchoolLifeCode.PERMISSION_REQUIRED, "Le tableau de bord de la vie scolaire exige la lecture générale."));
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const counts = await history.dashboardCounts(tx, viewer.audience, input.institutionId ?? null, todayOf(deps), deps.clock.now());
      const incidentRows = await incidentsRepo.listIncidents(tx, { audience: viewer.audience, openOnly: true, limit: 10, offset: 0 });
      const pendingRows = await measuresRepo.listMeasures(tx, { audience: viewer.audience, pendingOnly: true, limit: 10, offset: 0 });
      const convocationRows = await convocationsRepo.listConvocations(tx, { audience: viewer.audience, upcomingFrom: deps.clock.now(), limit: 10, offset: 0 });
      const involvements = await incidentsRepo.listInvolvements(tx, incidentRows.map((r) => r.id));
      const types = await loadTypes(tx, [...incidentRows.map((r) => r.typeId), ...pendingRows.map((r) => r.typeId)]);
      const names = await studentNames(deps, ctx, [...involvements.map((i) => i.studentId), ...pendingRows.map((r) => r.studentId), ...convocationRows.map((r) => r.studentId)]);
      const vc = { types, names };
      const appeals = await measuresRepo.listAppealsOf(tx, pendingRows.map((r) => r.id));
      return ok({
        ...counts,
        recentIncidents: incidentRows.map((r) => incidentDto(r, involvements, vc, { showStatements: false })),
        pendingMeasures: pendingRows.map((r) => measureDto(r, appeals, vc)),
        upcomingConvocations: convocationRows.map((r) => convocationDto(r, vc)),
      });
    },
    { readOnly: true },
  );
}

// ---------------------------------------------------------------------------
// API publique pour les autres modules (comptages et codes ; jamais de texte libre ni de confidentiel)
// ---------------------------------------------------------------------------

const FACTS_AUDIENCE = "STAFF_RESTRICTED";

export interface StudentLifeSummary extends factsRepo.LifeCounts {
  studentId: string;
  academicYearId: string;
}

export async function getStudentLifeSummary(deps: SchoolLifeDeps, ctx: RequestContext, input: { studentId: string; academicYearId: string }): Promise<StudentLifeSummary> {
  const counts = await deps.db.run(ctx, (tx) => factsRepo.lifeCountsOfStudent(tx, FACTS_AUDIENCE, input.studentId, input.academicYearId), { readOnly: true });
  return { studentId: input.studentId, academicYearId: input.academicYearId, ...counts };
}

export async function getClassroomLifeSummary(deps: SchoolLifeDeps, ctx: RequestContext, input: { enrollmentIds: readonly string[] }): Promise<history.ClassCounts[]> {
  return deps.db.run(ctx, (tx) => history.classroomCounts(tx, FACTS_AUDIENCE, input.enrollmentIds), { readOnly: true });
}

export async function getDisciplineFacts(deps: SchoolLifeDeps, ctx: RequestContext, input: { enrollmentId: string }): Promise<factsRepo.DisciplineBreakdownRow[]> {
  return deps.db.run(ctx, (tx) => factsRepo.disciplineBreakdown(tx, FACTS_AUDIENCE, input.enrollmentId), { readOnly: true });
}

/** Solde de points de conduite d'une inscription (AIDE : la note du bulletin reste une saisie humaine) ; `null` si aucun barème actif. */
export async function getConductPoints(deps: SchoolLifeDeps, ctx: RequestContext, input: { enrollmentId: string; periodId?: string | undefined }): Promise<{ scaleCode: string; isPlaceholder: boolean; points: number } | null> {
  const enrollment = await deps.ports.enrollments.getEnrollment(ctx, input.enrollmentId);
  if (!enrollment) return null;
  const view = await deps.db.run(ctx, (tx) => conductViewOf(deps, ctx, tx, enrollment.studentId, [enrollment], { academicYearId: enrollment.academicYearId, periodId: input.periodId }), { readOnly: true });
  return view.balance ? { scaleCode: view.balance.scaleCode, isPlaceholder: view.balance.isPlaceholder, points: view.balance.points } : null;
}
