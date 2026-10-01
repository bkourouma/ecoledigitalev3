/**
 * Cas d'usage des affectations d'enseignement (spec 009, US2) : qui est responsable de quoi.
 *
 * Une affectation n'est JAMAIS l'autorisation de paie (la paie lit l'intervenant réel d'une séance, spec 017). Les objets
 * d'academic (année, classe, nœud, période) sont des UUID sans clé étrangère : leur cohérence est vérifiée ICI via le port
 * `AcademicQuery` (classe et nœud existent, nœud dans le curriculum de la classe, nœud non transversal, période dans
 * l'année) ; sans ce port, toute création est refusée (échec fermé).
 */
import { ConflictError, err, ok, ValidationError, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import { isUniqueViolation, type Tx } from "@ecoledigitale/database";
import { PEOPLE_EVENTS, type PeopleAssignmentDto, type PeopleCreateAssignmentBody } from "@ecoledigitale/contracts/src/v2/people";
import {
  assignmentShapeProblems,
  isStaffAssigned,
  listUnstaffedNodes as unstaffedOf,
  resolveResponsible,
  CLASS_ACCESS_ROLES,
  type NodeFact,
  type Responsible,
} from "../domain/assignments";
import { PeopleErrors } from "../domain/errors";
import { addDays } from "../domain/normalize";
import { staffCanReceiveAssignments } from "../domain/status";
import { getStaffCategory } from "../infrastructure/reference-repo";
import * as staffRepo from "../infrastructure/staff-repo";
import * as repo from "../infrastructure/teaching-repo";
import { actorId, EventBuffer, inTx, todayOf, type PeopleDeps } from "./deps";
import type { AcademicNode, AcademicQuery } from "./ports";
import { assignmentView } from "./views";

export interface AssignmentWarning {
  code: string;
  message: string;
}

export interface CreateAssignmentResult {
  assignment: PeopleAssignmentDto;
  warnings: AssignmentWarning[];
}

function requireAcademic(deps: PeopleDeps): Result<AcademicQuery, AppError> {
  return deps.academic ? ok(deps.academic) : err(PeopleErrors.academicUnavailable());
}

function toFact(a: repo.AssignmentRow) {
  return { id: a.id, staffId: a.staffId, classroomId: a.classroomId, curriculumNodeId: a.curriculumNodeId, periodId: a.periodId, roleCode: a.roleCode, replacesAssignmentId: a.replacesAssignmentId, coversAllSubjects: a.coversAllSubjects, status: a.status, startsOn: a.startsOn, endsOn: a.endsOn };
}

interface Target {
  staffId: string;
  academicYearId: string;
  classroomId: string;
  curriculumNodeId?: string | null | undefined;
  periodId?: string | null | undefined;
  roleCode: PeopleCreateAssignmentBody["roleCode"];
  replacesAssignmentId?: string | null | undefined;
  coversAllSubjects?: boolean | undefined;
  startsOn: string;
  endsOn?: string | null | undefined;
}

/**
 * Vérifie une affectation avant écriture : forme, membre du personnel (actif, catégorie qui peut enseigner), cohérence
 * avec academic. Renvoie le nœud (pour les avertissements de compétence).
 */
async function validateTarget(deps: PeopleDeps, ctx: RequestContext, tx: Tx, t: Target): Promise<Result<{ node: AcademicNode | null }, AppError>> {
  const academicRes = requireAcademic(deps);
  if (!academicRes.ok) return academicRes;
  const academic = academicRes.value;
  const problems = assignmentShapeProblems(t);
  if (problems.length > 0) return err(PeopleErrors.assignmentInvalid(problems.join(" ")));
  if (t.endsOn && t.endsOn < t.startsOn) return err(PeopleErrors.assignmentInvalid("La date de fin précède le début.", "endsOn"));

  const staff = await staffRepo.getStaffRow(tx, ctx.tenantId, t.staffId);
  if (!staff) return err(PeopleErrors.staffNotFound(t.staffId));
  if (!staffCanReceiveAssignments(staff.status)) return err(PeopleErrors.assignmentStaffNotActive(staff.status));
  const category = await getStaffCategory(tx, ctx.tenantId, staff.categoryCode);
  const allowed = t.roleCode === "SUPERVISOR" ? Boolean(category?.canSupervise || category?.canTeach) : Boolean(category?.canTeach);
  if (!allowed) return err(PeopleErrors.categoryForbidden(staff.categoryCode));

  const classroom = await academic.getClassroom(ctx, t.classroomId);
  if (!classroom) return err(PeopleErrors.classroomNotFound(t.classroomId));
  if (classroom.academicYearId !== t.academicYearId) return err(PeopleErrors.assignmentInvalid("La classe n'appartient pas à cette année.", "academicYearId"));
  if (classroom.status === "DRAFT") return err(PeopleErrors.assignmentInvalid("La classe est en brouillon : son curriculum n'est pas encore stable.", "classroomId"));

  let node: AcademicNode | null = null;
  if (t.curriculumNodeId) {
    node = await academic.getCurriculumNode(ctx, t.curriculumNodeId);
    if (!node) return err(PeopleErrors.nodeNotInClassroom());
    if (node.isTransversal) return err(PeopleErrors.nodeTransversal());
    const nodes = await academic.listNodesForClassroom(ctx, t.classroomId, t.periodId ? { periodId: t.periodId } : undefined);
    if (!nodes.some((n) => n.id === t.curriculumNodeId)) return err(PeopleErrors.nodeNotInClassroom());
  }
  if (t.periodId) {
    const period = await academic.getAcademicPeriod(ctx, t.periodId);
    if (!period || period.academicYearId !== t.academicYearId) return err(PeopleErrors.periodOutsideYear());
  }
  return ok({ node });
}

async function conflictFor(tx: Tx, ctx: RequestContext, t: Target): Promise<AppError | null> {
  const conflicts = await repo.findActiveConflicts(tx, ctx.tenantId, {
    classroomId: t.classroomId,
    curriculumNodeId: t.curriculumNodeId ?? null,
    periodId: t.periodId ?? null,
    roleCode: t.roleCode,
    staffId: t.staffId,
  });
  const first = conflicts[0];
  if (!first) return null;
  if (t.roleCode === "LEAD") {
    return PeopleErrors.assignmentConflict(`Cette matière a déjà un responsable (${first.staffDisplayName ?? "membre du personnel"}) : ajoutez un co-enseignant (CO_TEACHER) ou terminez l'affectation existante.`, {
      existingAssignmentId: first.id,
      existingStaffId: first.staffId,
      suggestion: "CO_TEACHER",
    });
  }
  if (t.roleCode === "HOMEROOM" && first.staffId !== t.staffId) {
    return PeopleErrors.assignmentConflict(`Cette classe a déjà un titulaire (${first.staffDisplayName ?? "membre du personnel"}).`, { existingAssignmentId: first.id, existingStaffId: first.staffId });
  }
  return PeopleErrors.assignmentConflict("Cette affectation existe déjà.", { existingAssignmentId: first.id });
}

async function warningsFor(tx: Tx, ctx: RequestContext, t: Target, node: AcademicNode | null): Promise<AssignmentWarning[]> {
  const warnings: AssignmentWarning[] = [];
  if (node?.subjectId) {
    const competencies = await staffRepo.listCompetencies(tx, ctx.tenantId, t.staffId);
    if (!competencies.some((c) => c.subjectId === node.subjectId)) {
      warnings.push({ code: "people.no_matching_competency", message: "Ce membre du personnel n'a pas déclaré de compétence pour cette matière." });
    }
  }
  const contracts = await staffRepo.listContracts(tx, ctx.tenantId, t.staffId);
  const covered = contracts.some((c) => c.status === "ACTIVE" && c.startsOn <= t.startsOn && (c.endsOn === null || c.endsOn >= t.startsOn));
  if (!covered) warnings.push({ code: "people.no_active_contract", message: "Aucun contrat actif ne couvre le début de cette affectation (la paie décide)." });
  return warnings;
}

// ---------------------------------------------------------------------------
// Création, modification, fin, remplacement
// ---------------------------------------------------------------------------

export async function createTeachingAssignment(
  deps: PeopleDeps,
  ctx: RequestContext,
  input: PeopleCreateAssignmentBody,
  options: { source?: "MANUAL" | "IMPORT" | "TIMETABLE" | "ROLLOVER" } = {},
): Promise<Result<CreateAssignmentResult, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const now = deps.clock.now();
    const target: Target = { ...input, curriculumNodeId: input.curriculumNodeId ?? null, periodId: input.periodId ?? null };
    const valid = await validateTarget(deps, ctx, tx, target);
    if (!valid.ok) return valid;
    if (input.roleCode === "SUBSTITUTE" && input.replacesAssignmentId) {
      const replaced = await repo.getAssignment(tx, ctx.tenantId, input.replacesAssignmentId);
      if (!replaced || replaced.status !== "ACTIVE" || replaced.classroomId !== input.classroomId) {
        return err(PeopleErrors.assignmentInvalid("L'affectation remplacée doit être active et dans la même classe.", "replacesAssignmentId"));
      }
    }
    const conflict = await conflictFor(tx, ctx, target);
    if (conflict) return err(conflict);

    const id = deps.newId();
    try {
      await repo.insertAssignment(
        tx,
        ctx.tenantId,
        {
          id,
          staffId: input.staffId,
          academicYearId: input.academicYearId,
          classroomId: input.classroomId,
          curriculumNodeId: input.curriculumNodeId ?? null,
          periodId: input.periodId ?? null,
          roleCode: input.roleCode,
          replacesAssignmentId: input.replacesAssignmentId ?? null,
          coversAllSubjects: input.coversAllSubjects ?? false,
          plannedHours: input.plannedHours ?? null,
          startsOn: input.startsOn,
          endsOn: input.endsOn ?? null,
          source: options.source ?? "MANUAL",
          note: input.note ?? null,
          createdBy: actorId(ctx),
        },
        now,
      );
    } catch (e) {
      if (isUniqueViolation(e)) return err(PeopleErrors.assignmentConflict("Une affectation équivalente vient d'être créée."));
      throw e;
    }
    await repo.insertAssignmentHistory(tx, ctx.tenantId, { id: deps.newId(), assignmentId: id, kind: "CREATED", toValue: { staffId: input.staffId, roleCode: input.roleCode }, actorId: actorId(ctx) }, now);
    const buffer = new EventBuffer(deps, ctx);
    buffer.add(
      PEOPLE_EVENTS.teachingAssignmentCreated,
      { v: 1, assignmentId: id, staffId: input.staffId, classroomId: input.classroomId, curriculumNodeId: input.curriculumNodeId ?? null, roleCode: input.roleCode },
      { type: "teaching_assignment", id },
    );
    buffer.audit({ action: "people.teaching_assignment.created", entity: "teaching_assignment", entityId: id, metadata: { staffId: input.staffId, classroomId: input.classroomId, roleCode: input.roleCode } });
    await buffer.flush(tx);
    const row = await repo.getAssignment(tx, ctx.tenantId, id);
    if (!row) throw new Error("Affectation introuvable après création.");
    return ok({ assignment: assignmentView(row), warnings: await warningsFor(tx, ctx, target, valid.value.node) });
  });
}

export async function updateTeachingAssignment(
  deps: PeopleDeps,
  ctx: RequestContext,
  assignmentId: string,
  patch: { plannedHours?: number | null | undefined; endsOn?: string | null | undefined; note?: string | null | undefined },
): Promise<Result<PeopleAssignmentDto, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const now = deps.clock.now();
    const current = await repo.getAssignment(tx, ctx.tenantId, assignmentId, { forUpdate: true });
    if (!current) return err(PeopleErrors.assignmentNotFound(assignmentId));
    if (current.status !== "ACTIVE") return err(PeopleErrors.assignmentClosed());
    if (patch.endsOn && patch.endsOn < current.startsOn) return err(PeopleErrors.assignmentInvalid("La date de fin précède le début.", "endsOn"));
    await repo.updateAssignmentFields(tx, ctx.tenantId, assignmentId, patch, now);
    await repo.insertAssignmentHistory(tx, ctx.tenantId, { id: deps.newId(), assignmentId, kind: "UPDATED", fromValue: { plannedHours: current.plannedHours, endsOn: current.endsOn }, toValue: patch, actorId: actorId(ctx) }, now);
    const buffer = new EventBuffer(deps, ctx);
    buffer.audit({ action: "people.teaching_assignment.updated", entity: "teaching_assignment", entityId: assignmentId, metadata: { fields: Object.keys(patch).sort() } });
    await buffer.flush(tx);
    const row = await repo.getAssignment(tx, ctx.tenantId, assignmentId);
    return row ? ok(assignmentView(row)) : err(PeopleErrors.assignmentNotFound(assignmentId));
  });
}

/** Termine une affectation (elle ne se réactive jamais : on en crée une nouvelle). */
export async function endTeachingAssignment(deps: PeopleDeps, ctx: RequestContext, assignmentId: string, input: { endsOn?: string | undefined; reason?: string | undefined } = {}): Promise<Result<PeopleAssignmentDto, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const now = deps.clock.now();
    const current = await repo.getAssignment(tx, ctx.tenantId, assignmentId, { forUpdate: true });
    if (!current) return err(PeopleErrors.assignmentNotFound(assignmentId));
    if (current.status !== "ACTIVE") return err(PeopleErrors.assignmentClosed());
    const endsOn = input.endsOn ?? todayOf(deps);
    if (endsOn < current.startsOn) return err(PeopleErrors.assignmentInvalid("La date de fin précède le début.", "endsOn"));
    await repo.updateAssignmentFields(tx, ctx.tenantId, assignmentId, { status: "ENDED", endsOn }, now);
    await repo.insertAssignmentHistory(tx, ctx.tenantId, { id: deps.newId(), assignmentId, kind: "ENDED", reason: input.reason, actorId: actorId(ctx) }, now);
    const buffer = new EventBuffer(deps, ctx);
    buffer.add(PEOPLE_EVENTS.teachingAssignmentEnded, { v: 1, assignmentId, staffId: current.staffId, classroomId: current.classroomId, reason: "MANUAL" }, { type: "teaching_assignment", id: assignmentId });
    buffer.audit({ action: "people.teaching_assignment.ended", entity: "teaching_assignment", entityId: assignmentId, reason: input.reason ?? null, metadata: { staffId: current.staffId, endsOn } });
    await buffer.flush(tx);
    const row = await repo.getAssignment(tx, ctx.tenantId, assignmentId);
    return row ? ok(assignmentView(row)) : err(PeopleErrors.assignmentNotFound(assignmentId));
  });
}

/**
 * Remplace le responsable d'une affectation EN UNE transaction : l'ancienne se termine la veille de la date d'effet, la
 * nouvelle (même objet, même rôle) commence à cette date. Les séances PASSÉES gardent leurs intervenants réels (017) ; les
 * séances futures sont signalées à scheduling par l'événement `people.teaching_assignment.replaced`.
 */
export async function replaceTeachingAssignment(
  deps: PeopleDeps,
  ctx: RequestContext,
  assignmentId: string,
  input: { newStaffId: string; effectiveOn: string; reason: string },
): Promise<Result<CreateAssignmentResult & { replacedAssignment: PeopleAssignmentDto }, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const now = deps.clock.now();
    const old = await repo.getAssignment(tx, ctx.tenantId, assignmentId, { forUpdate: true });
    if (!old) return err(PeopleErrors.assignmentNotFound(assignmentId));
    if (old.status !== "ACTIVE") return err(PeopleErrors.assignmentClosed());
    if (old.staffId === input.newStaffId) return err(PeopleErrors.assignmentInvalid("Le nouveau responsable est déjà le titulaire de cette affectation.", "newStaffId"));

    const target: Target = {
      staffId: input.newStaffId,
      academicYearId: old.academicYearId,
      classroomId: old.classroomId,
      curriculumNodeId: old.curriculumNodeId,
      periodId: old.periodId,
      roleCode: old.roleCode,
      replacesAssignmentId: old.replacesAssignmentId,
      coversAllSubjects: old.coversAllSubjects,
      startsOn: input.effectiveOn,
      endsOn: old.endsOn,
    };
    if (old.endsOn && input.effectiveOn > old.endsOn) return err(PeopleErrors.assignmentInvalid("La date d'effet suit la fin de l'affectation.", "effectiveOn"));
    const valid = await validateTarget(deps, ctx, tx, target);
    if (!valid.ok) return valid;

    // 1. terminer l'ancienne (la veille ; si elle n'a jamais pris effet, elle est annulée)
    const lastDay = addDays(input.effectiveOn, -1);
    if (lastDay < old.startsOn) {
      await repo.updateAssignmentFields(tx, ctx.tenantId, assignmentId, { status: "CANCELLED", endsOn: old.startsOn }, now);
    } else {
      await repo.updateAssignmentFields(tx, ctx.tenantId, assignmentId, { status: "ENDED", endsOn: lastDay }, now);
    }
    // 2. créer la nouvelle (après l'ancienne : l'index unique ne couvre que les ACTIVES)
    const conflict = await conflictFor(tx, ctx, target);
    if (conflict) return err(conflict);
    const newId = deps.newId();
    await repo.insertAssignment(
      tx,
      ctx.tenantId,
      {
        id: newId,
        staffId: input.newStaffId,
        academicYearId: old.academicYearId,
        classroomId: old.classroomId,
        curriculumNodeId: old.curriculumNodeId,
        periodId: old.periodId,
        roleCode: old.roleCode,
        replacesAssignmentId: old.replacesAssignmentId,
        coversAllSubjects: old.coversAllSubjects,
        plannedHours: old.plannedHours === null ? null : Number(old.plannedHours),
        startsOn: input.effectiveOn,
        endsOn: old.endsOn,
        source: "MANUAL",
        note: old.note,
        createdBy: actorId(ctx),
      },
      now,
    );
    await repo.insertAssignmentHistory(tx, ctx.tenantId, { id: deps.newId(), assignmentId, kind: "REPLACED", fromValue: { staffId: old.staffId }, toValue: { staffId: input.newStaffId, newAssignmentId: newId }, reason: input.reason, actorId: actorId(ctx) }, now);
    await repo.insertAssignmentHistory(tx, ctx.tenantId, { id: deps.newId(), assignmentId: newId, kind: "CREATED", toValue: { staffId: input.newStaffId, replaces: assignmentId }, reason: input.reason, actorId: actorId(ctx) }, now);

    const buffer = new EventBuffer(deps, ctx);
    buffer.add(
      PEOPLE_EVENTS.teachingAssignmentReplaced,
      { v: 1, oldAssignmentId: assignmentId, newAssignmentId: newId, oldStaffId: old.staffId, newStaffId: input.newStaffId, classroomId: old.classroomId, curriculumNodeId: old.curriculumNodeId, effectiveOn: input.effectiveOn },
      { type: "teaching_assignment", id: newId },
    );
    buffer.audit({ action: "people.teaching_assignment.replaced", entity: "teaching_assignment", entityId: newId, severity: "notice", reason: input.reason, metadata: { oldAssignmentId: assignmentId, oldStaffId: old.staffId, newStaffId: input.newStaffId, effectiveOn: input.effectiveOn } });
    await buffer.flush(tx);
    const created = await repo.getAssignment(tx, ctx.tenantId, newId);
    const ended = await repo.getAssignment(tx, ctx.tenantId, assignmentId);
    if (!created || !ended) throw new Error("Affectations introuvables après remplacement.");
    return ok({ assignment: assignmentView(created), replacedAssignment: assignmentView(ended), warnings: await warningsFor(tx, ctx, target, valid.value.node) });
  });
}

/**
 * Termine les affectations actives d'une classe ou d'une année (consommé à `academic.classroom.cancelled|completed`,
 * `academic.year.closed`). S'exécute dans la transaction du consommateur (`tx` fournie par l'abonné idempotent).
 */
export async function endAssignmentsForScope(
  deps: PeopleDeps,
  tx: Tx,
  ctx: RequestContext,
  scope: { classroomId?: string | undefined; yearId?: string | undefined },
  options: { endsOn?: string | undefined; reason: string },
): Promise<number> {
  const now = deps.clock.now();
  const ended = await repo.endActiveByScope(tx, ctx.tenantId, scope, options.endsOn ?? todayOf(deps), now);
  const buffer = new EventBuffer(deps, ctx);
  for (const a of ended) {
    await repo.insertAssignmentHistory(tx, ctx.tenantId, { id: deps.newId(), assignmentId: a.id, kind: "ENDED", reason: options.reason, actorId: null }, now);
    buffer.add(PEOPLE_EVENTS.teachingAssignmentEnded, { v: 1, assignmentId: a.id, staffId: a.staffId, classroomId: a.classroomId, reason: options.reason }, { type: "teaching_assignment", id: a.id });
  }
  if (ended.length > 0) buffer.audit({ action: "people.teaching_assignment.ended_by_event", entity: "teaching_assignment", severity: "info", reason: options.reason, metadata: { count: ended.length, ...scope } });
  await buffer.flush(tx);
  return ended.length;
}

// ---------------------------------------------------------------------------
// Lecture
// ---------------------------------------------------------------------------

export async function getTeachingAssignment(deps: PeopleDeps, ctx: RequestContext, assignmentId: string): Promise<Result<PeopleAssignmentDto, AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const row = await repo.getAssignment(tx, ctx.tenantId, assignmentId);
      return row ? ok(assignmentView(row)) : err(PeopleErrors.assignmentNotFound(assignmentId));
    },
    { readOnly: true },
  );
}

export async function listAssignmentsForClassroom(
  deps: PeopleDeps,
  ctx: RequestContext,
  classroomId: string,
  options: { onDate?: string | undefined; status?: string | undefined } = {},
): Promise<Result<PeopleAssignmentDto[], AppError>> {
  return inTx(deps, ctx, async (tx) => ok((await repo.listAssignmentRows(tx, ctx.tenantId, { classroomId, onDate: options.onDate, status: options.status })).map(assignmentView)), { readOnly: true });
}

export async function listAssignmentsForStaff(
  deps: PeopleDeps,
  ctx: RequestContext,
  staffId: string,
  options: { yearId?: string | undefined; onDate?: string | undefined; status?: string | undefined } = {},
): Promise<Result<PeopleAssignmentDto[], AppError>> {
  return inTx(deps, ctx, async (tx) => ok((await repo.listAssignmentRows(tx, ctx.tenantId, { staffId, yearId: options.yearId, onDate: options.onDate, status: options.status })).map(assignmentView)), { readOnly: true });
}

/** Classes où le membre du personnel est affecté à la date du jour (portail « mes classes ») avec ses affectations. */
export async function listMyClasses(deps: PeopleDeps, ctx: RequestContext, staffId: string, onDate?: string) {
  const date = onDate ?? todayOf(deps);
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const rows = await repo.listAssignmentRows(tx, ctx.tenantId, { staffId, onDate: date });
      const byClass = new Map<string, { classroomId: string; academicYearId: string; assignments: Array<{ assignmentId: string; roleCode: string; curriculumNodeId: string | null; coversAllSubjects: boolean }> }>();
      for (const a of rows) {
        const entry = byClass.get(a.classroomId) ?? { classroomId: a.classroomId, academicYearId: a.academicYearId, assignments: [] };
        entry.assignments.push({ assignmentId: a.id, roleCode: a.roleCode, curriculumNodeId: a.curriculumNodeId, coversAllSubjects: a.coversAllSubjects });
        byClass.set(a.classroomId, entry);
      }
      return ok([...byClass.values()]);
    },
    { readOnly: true },
  );
}

/** Le responsable d'un nœud dans une classe : `LEAD` explicite > généraliste > titulaire ; « aucun » pour un nœud transversal. */
export async function getResponsibleForNode(
  deps: PeopleDeps,
  ctx: RequestContext,
  input: { classroomId: string; nodeId: string; periodId?: string | undefined; onDate?: string | undefined },
): Promise<Result<Responsible | null, AppError>> {
  // Sans academic, on ne peut pas savoir si le nœud est transversal : il est supposé NON transversal (les affectations
  // ne portent jamais sur un nœud transversal, la création l'ayant refusé).
  const node = deps.academic ? await deps.academic.getCurriculumNode(ctx, input.nodeId) : null;
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const facts = await repo.listAssignmentFacts(tx, ctx.tenantId, [input.classroomId]);
      return ok(resolveResponsible(facts, { classroomId: input.classroomId, nodeId: input.nodeId, nodeIsTransversal: node?.isTransversal ?? false, periodId: input.periodId, onDate: input.onDate ?? todayOf(deps) }));
    },
    { readOnly: true },
  );
}

/** Règle de domaine « ce membre du personnel est bien affecté à cette classe (et à ce nœud) » : autorise notes, appel, listes. */
export async function isStaffAssignedToClassroom(
  deps: PeopleDeps,
  ctx: RequestContext,
  input: { staffId: string; classroomId: string; nodeId?: string | undefined; onDate?: string | undefined },
): Promise<boolean> {
  return deps.db.run(
    ctx,
    async (tx) => {
      const facts = await repo.listAssignmentFacts(tx, ctx.tenantId, [input.classroomId]);
      return isStaffAssigned(facts, { staffId: input.staffId, classroomId: input.classroomId, nodeId: input.nodeId, onDate: input.onDate ?? todayOf(deps) });
    },
    { readOnly: true },
  );
}

/** Classes où le membre est affecté à la date (visibilité des élèves d'un enseignant). */
export async function listClassroomIdsOfStaff(deps: PeopleDeps, ctx: RequestContext, staffId: string, onDate?: string): Promise<string[]> {
  return deps.db.run(ctx, (tx) => repo.listClassroomIdsOfStaff(tx, ctx.tenantId, staffId, onDate ?? todayOf(deps), CLASS_ACCESS_ROLES), { readOnly: true });
}

export interface UnstaffedNode {
  classroomId: string;
  curriculumNodeId: string;
  label: string | null;
}

/** Nœuds obligatoires non transversaux sans responsable (rapport « matières sans enseignant ») : donnée brute, sans seuil. */
export async function listUnstaffedNodes(deps: PeopleDeps, ctx: RequestContext, input: { yearId: string; classroomId?: string | undefined; programId?: string | undefined; onDate?: string | undefined }): Promise<Result<UnstaffedNode[], AppError>> {
  const academicRes = requireAcademic(deps);
  if (!academicRes.ok) return academicRes;
  const academic = academicRes.value;
  let classroomIds: string[];
  if (input.classroomId) classroomIds = [input.classroomId];
  else if (academic.listClassrooms) classroomIds = (await academic.listClassrooms(ctx, { academicYearId: input.yearId, ...(input.programId ? { programId: input.programId } : {}) })).map((c) => c.id);
  else return err(PeopleErrors.academicUnavailable());
  const onDate = input.onDate ?? todayOf(deps);
  const nodesByClass = new Map<string, AcademicNode[]>();
  for (const id of classroomIds) nodesByClass.set(id, await academic.listNodesForClassroom(ctx, id));
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const facts = await repo.listAssignmentFacts(tx, ctx.tenantId, classroomIds);
      const out: UnstaffedNode[] = [];
      for (const [classroomId, nodes] of nodesByClass) {
        const nodeFacts: NodeFact[] = nodes.map((n) => ({ id: n.id, isMandatory: n.isMandatory, isTransversal: n.isTransversal, label: n.label ?? null }));
        for (const n of unstaffedOf(nodeFacts, facts, { classroomId, onDate })) out.push({ classroomId, curriculumNodeId: n.id, label: n.label ?? null });
      }
      return ok(out);
    },
    { readOnly: true },
  );
}

// ---------------------------------------------------------------------------
// Garde d'ouverture d'offre (port `OfferingReadinessGuard` d'academic)
// ---------------------------------------------------------------------------

export class OfferingNotReadyError extends ConflictError {
  constructor(readonly missing: ReadonlyArray<{ classroomId: string; curriculumNodeId: string; label: string | null }>) {
    super("Chaque matière obligatoire doit avoir un responsable avant l'ouverture.", { code: "people.teaching_staff_missing", details: { missing } });
  }
}

export interface OfferingReadinessGuard {
  /** `Ok` si chaque nœud obligatoire non transversal de l'offre a un `LEAD` actif, sinon `Err(OfferingNotReadyError)` portant `missing[]`. */
  check(ctx: RequestContext, offeringId: string): Promise<Result<void, AppError & { missing?: OfferingNotReadyError["missing"] }>>;
}

export function createOfferingReadinessGuard(deps: PeopleDeps): OfferingReadinessGuard {
  return {
    async check(ctx, offeringId) {
      const academicRes = requireAcademic(deps);
      if (!academicRes.ok) return academicRes;
      const academic = academicRes.value;
      if (!academic.getOffering) return err(PeopleErrors.academicUnavailable());
      const offering = await academic.getOffering(ctx, offeringId);
      if (!offering) return err(ValidationError.field("offeringId", "Offre introuvable.", "people.offering_not_found"));
      const classNodes = await academic.listNodesForClassroom(ctx, offering.classroomId, offering.periodId ? { periodId: offering.periodId } : undefined);
      const wanted = new Set(offering.nodeIds);
      const nodes: NodeFact[] = classNodes.filter((n) => wanted.has(n.id)).map((n) => ({ id: n.id, isMandatory: n.isMandatory, isTransversal: n.isTransversal, label: n.label ?? null }));
      const result = await inTx(
        deps,
        ctx,
        async (tx) => {
          const facts = await repo.listAssignmentFacts(tx, ctx.tenantId, [offering.classroomId]);
          return ok(unstaffedOf(nodes, facts, { classroomId: offering.classroomId, periodId: offering.periodId ?? undefined, onDate: todayOf(deps) }));
        },
        { readOnly: true },
      );
      if (!result.ok) return result;
      if (result.value.length === 0) return ok(undefined);
      return err(new OfferingNotReadyError(result.value.map((n) => ({ classroomId: offering.classroomId, curriculumNodeId: n.id, label: n.label ?? null }))));
    },
  };
}
