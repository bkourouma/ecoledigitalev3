/**
 * Faits publiés pour les adaptateurs de la plateforme (results, higher, attendance, scheduling, payroll) : lectures
 * seules, dans le périmètre du contexte (404 hors périmètre), sans effet de bord. Voir `domain/facts.ts` pour les formes.
 *
 * Extension ADDITIVE du module (migration 0706) : ces lectures remplacent, côté `academic`, ce que les modules voisins
 * déduisaient auparavant d'un libellé (« Terminale », « semestre 2 », « licence 1 »…).
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import { followedNodes } from "../domain/curriculum";
import { SCHOOLING_COURSE_STATUSES } from "../domain/enrollment";
import { AcademicCode, notFound } from "../domain/errors";
import { countRepeatYears, effectiveContract, periodFactsOf, structureNodesOf } from "../domain/facts";
import type { ClassroomEnrollmentFacts, ClassroomFacts, CycleEnrollmentFacts, CycleFacts, EnrollmentEligibilityFacts, LastEnrollmentFacts, ResultsStructure, UeFacts } from "../domain/facts";
import * as cal from "../infrastructure/calendar-repository";
import * as classroomsRepo from "../infrastructure/classroom-repository";
import * as cur from "../infrastructure/curriculum-repository";
import * as enr from "../infrastructure/enrollment-repository";
import * as facts from "../infrastructure/facts-repository";
import * as ref from "../infrastructure/reference-repository";
import { inReadTx, inScope, type AcademicDeps } from "./deps";
import { loadClassroomInScope } from "./calendar";
import { loadEnrollmentInScope } from "./enrollment-core";
import { periodChainOf } from "./reads";

async function programInScope(tx: Parameters<typeof cur.getProgram>[0], ctx: RequestContext, programId: string): Promise<Result<NonNullable<Awaited<ReturnType<typeof cur.getProgram>>>, AppError>> {
  const p = await cur.getProgram(tx, programId);
  return p && inScope(ctx, p) ? ok(p) : err(notFound(AcademicCode.PROGRAM_NOT_FOUND, "Programme", programId));
}

/**
 * Structure de calcul d'une classe × période (port `CurriculumPort` de `results`) : nœuds UE / ECUE / SUBJECT suivis par la
 * classe (mode CLASSE) pour la période, avec crédits, coefficients, mode de saisie, rattrapage, section, faits de période,
 * contrat de calcul et drapeau d'examen terminal. Une classe sans curriculum a une liste de nœuds vide.
 */
export async function getResultsStructure(deps: AcademicDeps, ctx: RequestContext, input: { classroomId: string; periodId: string }): Promise<Result<ResultsStructure, AppError>> {
  return inReadTx(deps, ctx, async (tx) => {
    const c = await loadClassroomInScope(tx, ctx, input.classroomId);
    if (!c.ok) return c;
    const classroom = c.value;
    const chain = await periodChainOf(tx, input.periodId);
    if (!chain || chain.period.academicYearId !== classroom.academicYearId) return err(notFound(AcademicCode.PERIOD_NOT_FOUND, "Période", input.periodId));
    const types = new Map((await ref.listPeriodTypes(tx)).map((t) => [t.code, t]));
    const pf = periodFactsOf(chain.all, input.periodId, types);
    if (!pf) return err(notFound(AcademicCode.PERIOD_NOT_FOUND, "Période", input.periodId));
    const program = await cur.getProgram(tx, classroom.programId);
    const grade = await ref.getGradeLevel(tx, classroom.gradeLevelId);
    if (!program || !grade) return err(notFound(AcademicCode.PROGRAM_NOT_FOUND, "Programme ou niveau de la classe"));
    const level = await ref.getEducationLevel(tx, grade.educationLevelId);
    const nodes = classroom.curriculumVersionId
      ? structureNodesOf(
          followedNodes({
            nodes: await cur.listNodes(tx, classroom.curriculumVersionId),
            nodeTypes: await ref.listNodeTypes(tx),
            mode: "CLASS",
            classGradeLevelId: classroom.gradeLevelId,
            selections: [],
            periodChain: chain.chain,
          }).map((f) => f.node),
        )
      : [];
    const first = pf.yearPeriods[0];
    return ok<ResultsStructure>({
      classroomId: classroom.id,
      academicYearId: classroom.academicYearId,
      institutionId: classroom.institutionId,
      programId: program.id,
      educationLevelCode: level?.code ?? "",
      gradeLevelCode: grade.code,
      calculationContract: effectiveContract(program, level),
      terminalExamRequired: grade.terminalExamRequired,
      period: pf.period,
      firstPeriodId: first && first.id !== pf.period.id ? first.id : null,
      yearPeriods: pf.yearPeriods,
      nodes,
    });
  });
}

/** Faits d'une classe : niveau d'enseignement, niveau, bornes de l'année, effectif, statut. */
export async function getClassroomFacts(deps: AcademicDeps, ctx: RequestContext, classroomId: string): Promise<Result<ClassroomFacts, AppError>> {
  return inReadTx(deps, ctx, async (tx) => {
    const c = await loadClassroomInScope(tx, ctx, classroomId);
    if (!c.ok) return c;
    const classroom = c.value;
    const [program, grade, year] = await Promise.all([cur.getProgram(tx, classroom.programId), ref.getGradeLevel(tx, classroom.gradeLevelId), cal.getYear(tx, classroom.academicYearId)]);
    if (!program || !grade || !year) return err(notFound(AcademicCode.PROGRAM_NOT_FOUND, "Programme, niveau ou année de la classe"));
    const level = await ref.getEducationLevel(tx, grade.educationLevelId);
    return ok<ClassroomFacts>({
      classroomId: classroom.id,
      name: classroom.name,
      institutionId: classroom.institutionId,
      campusId: classroom.campusId,
      academicYearId: classroom.academicYearId,
      academicYearStartsOn: year.startsOn,
      academicYearEndsOn: year.endsOn,
      academicYearCode: year.code,
      academicYearLabel: year.label,
      programId: program.id,
      programCode: program.code,
      programLabel: program.label,
      educationLevelCode: level?.code ?? "",
      pack: (level?.pack as ClassroomFacts["pack"]) ?? null,
      gradeLevelCode: grade.code,
      gradeLevelLabel: grade.label,
      kind: classroom.kind,
      status: classroom.status,
      headcount: classroom.enrolledCount,
      curriculumVersionId: classroom.curriculumVersionId,
    });
  });
}

/** Toutes les inscriptions d'une classe (actives ou non) : une note reste attachée à son inscription d'origine. */
export async function listClassroomEnrollments(deps: AcademicDeps, ctx: RequestContext, classroomId: string): Promise<Result<ClassroomEnrollmentFacts[], AppError>> {
  return inReadTx(deps, ctx, async (tx) => {
    const c = await loadClassroomInScope(tx, ctx, classroomId);
    if (!c.ok) return c;
    return ok(await facts.listEnrollmentsOfClassroom(tx, classroomId));
  });
}

/** Un programme (ou un sous-programme) : est-il un cycle conduisant à un diplôme ? */
export async function getCycleFacts(deps: AcademicDeps, ctx: RequestContext, programId: string): Promise<Result<CycleFacts, AppError>> {
  return inReadTx(deps, ctx, async (tx) => {
    const p = await programInScope(tx, ctx, programId);
    if (!p.ok) return p;
    return ok<CycleFacts>({ programId: p.value.id, code: p.value.code, label: p.value.label, isCycle: p.value.isCycle, institutionId: p.value.institutionId });
  });
}

/** UE (identité = lignée) du programme ou du cycle et de ses sous-programmes, dans la version la plus récente. */
export async function listProgramUe(deps: AcademicDeps, ctx: RequestContext, programId: string): Promise<Result<UeFacts[], AppError>> {
  return inReadTx(deps, ctx, async (tx) => {
    const p = await programInScope(tx, ctx, programId);
    if (!p.ok) return p;
    return ok(await facts.latestUeOfPrograms(tx, await facts.programScope(tx, programId)));
  });
}

/** UE d'une lignée (version la plus récente qui la contient). `null` si inconnue ou hors périmètre. */
export async function getUeFacts(deps: AcademicDeps, ctx: RequestContext, lineageId: string): Promise<Result<UeFacts | null, AppError>> {
  return inReadTx(deps, ctx, async (tx) => {
    const ue = await facts.ueByLineage(tx, lineageId);
    if (!ue) return ok(null);
    const p = await cur.getProgram(tx, ue.programId);
    return ok(p && inScope(ctx, p) ? ue : null);
  });
}

export async function listCycleEnrollments(deps: AcademicDeps, ctx: RequestContext, programId: string): Promise<Result<CycleEnrollmentFacts[], AppError>> {
  return inReadTx(deps, ctx, async (tx) => {
    const p = await programInScope(tx, ctx, programId);
    if (!p.ok) return p;
    return ok(await facts.listCycleEnrollments(tx, await facts.programScope(tx, programId)));
  });
}

export async function getLastEnrollmentInProgram(deps: AcademicDeps, ctx: RequestContext, input: { studentId: string; programId: string }): Promise<Result<LastEnrollmentFacts | null, AppError>> {
  return inReadTx(deps, ctx, async (tx) => {
    const p = await programInScope(tx, ctx, input.programId);
    if (!p.ok) return p;
    return ok(await facts.lastEnrollmentInPrograms(tx, input.studentId, await facts.programScope(tx, input.programId)));
  });
}

/** Étudiants actuellement inscrits à une UE (lignée) : inscription ACTIVE de la classe du niveau de l'UE, ou sélection confirmée. */
export async function listUeRegistrants(deps: AcademicDeps, ctx: RequestContext, lineageId: string): Promise<Result<string[], AppError>> {
  return inReadTx(deps, ctx, async (tx) => ok(await facts.studentsFollowingLineage(tx, lineageId, ["ACTIVE"], ["CONFIRMED"])));
}

/** L'étudiant a-t-il SUIVI l'UE (inscription active ou terminée, sélection confirmée ou terminée) ? */
export async function hasAttendedUe(deps: AcademicDeps, ctx: RequestContext, input: { studentId: string; lineageId: string }): Promise<Result<boolean, AppError>> {
  return inReadTx(deps, ctx, async (tx) => ok(await facts.studentFollowsLineage(tx, input.studentId, input.lineageId, ["ACTIVE", "COMPLETED"], SCHOOLING_COURSE_STATUSES)));
}

/**
 * Faits d'éligibilité d'une inscription (port `EligibilityFacts` de 018, spec 018 §13/§16) : niveau et cycle (codes), drapeau
 * INFORMATIF d'examen terminal du niveau, classe, année, statut, redoublements du cycle. Aucune donnée d'identité ; aucune
 * décision : l'éligibilité elle-même est évaluée par `rules` / `examinations` à partir de ces faits. 404 hors périmètre.
 */
export async function getEligibilityFacts(deps: AcademicDeps, ctx: RequestContext, enrollmentId: string): Promise<Result<EnrollmentEligibilityFacts, AppError>> {
  return inReadTx(deps, ctx, async (tx) => {
    const l = await loadEnrollmentInScope(tx, ctx, enrollmentId);
    if (!l.ok) return l;
    const e = l.value;
    const classroom = await classroomsRepo.getClassroom(tx, e.classroomId);
    const year = await cal.getYear(tx, e.academicYearId);
    const grade = classroom ? await ref.getGradeLevel(tx, classroom.gradeLevelId) : null;
    if (!classroom || !year || !grade) return err(notFound(AcademicCode.GRADE_LEVEL_NOT_FOUND, "Classe, année ou niveau de l'inscription", enrollmentId));
    const level = await ref.getEducationLevel(tx, grade.educationLevelId);
    const years = await facts.listRepeatYearsInCycle(tx, { studentId: e.studentId, educationLevelId: grade.educationLevelId, institutionId: ctx.institutionId ?? null });
    return ok<EnrollmentEligibilityFacts>({
      enrollmentId: e.id,
      studentId: e.studentId,
      institutionId: e.institutionId,
      academicYearId: e.academicYearId,
      academicYearCode: year.code,
      classroomId: e.classroomId,
      gradeLevelCode: grade.code,
      educationLevelCode: level?.code ?? "",
      pack: (level?.pack as EnrollmentEligibilityFacts["pack"]) ?? null,
      terminalExamRequired: grade.terminalExamRequired,
      status: e.status,
      mode: e.mode,
      isRepeating: e.isRepeating,
      repeatsInCycle: countRepeatYears(years, { startsOn: year.startsOn }),
      repeatsBeforeYear: countRepeatYears(years, { startsOn: year.startsOn, strict: true }),
    });
  });
}

/**
 * Nombre de redoublements de l'élève dans un cycle d'enseignement (code de donnée, ex. `PRIMARY`) — entrée de la règle
 * `cas_deja_redoublant` (spec 005). Sans `academicYearId` : toutes les années ; avec : jusqu'à cette année INCLUSE
 * (`beforeYear: true` = strictement avant). Compte les années marquées `is_repeating` ou qui suivent une issue de type `REPEAT`,
 * une fois chacune ; les inscriptions annulées ou en attente ne comptent pas.
 */
export async function countRepeatsInCycle(
  deps: AcademicDeps,
  ctx: RequestContext,
  input: { studentId: string; educationLevelCode: string; academicYearId?: string | null | undefined; beforeYear?: boolean | undefined },
): Promise<Result<number, AppError>> {
  return inReadTx(deps, ctx, async (tx) => {
    const level = (await ref.listEducationLevels(tx)).find((l) => l.code === input.educationLevelCode);
    if (!level) return err(notFound(AcademicCode.EDUCATION_LEVEL_NOT_FOUND, "Cycle d'enseignement", input.educationLevelCode));
    let bound: { startsOn: string; strict: boolean } | null = null;
    if (input.academicYearId) {
      const year = await cal.getYear(tx, input.academicYearId);
      if (!year || (ctx.institutionId && year.institutionId !== ctx.institutionId)) return err(notFound(AcademicCode.YEAR_NOT_FOUND, "Année académique", input.academicYearId));
      bound = { startsOn: year.startsOn, strict: input.beforeYear === true };
    }
    const years = await facts.listRepeatYearsInCycle(tx, { studentId: input.studentId, educationLevelId: level.id, institutionId: ctx.institutionId ?? null });
    return ok(countRepeatYears(years, bound));
  });
}

/** Placements ACTIFS d'un apprenant (classes et offres suivies) : emploi du temps élève / parent. */
export async function listStudentPlacements(deps: AcademicDeps, ctx: RequestContext, studentId: string): Promise<Result<{ classroomIds: string[]; offeringIds: string[] }, AppError>> {
  return inReadTx(deps, ctx, async (tx) => {
    const p = await facts.placementsOfStudent(tx, studentId);
    // Hors périmètre : classes d'un autre établissement écartées (le contexte n'y a pas accès).
    const classroomIds: string[] = [];
    for (const id of p.classroomIds) {
      const c = await classroomsRepo.getClassroom(tx, id);
      if (c && inScope(ctx, c)) classroomIds.push(id);
    }
    return ok({ classroomIds, offeringIds: p.offeringIds });
  });
}

/** L'apprenant a-t-il TERMINÉ une sélection de cours sur cette lignée ? (repli de `CompletionLookup`, lecture locale.) */
export async function hasCompletedSelection(deps: AcademicDeps, ctx: RequestContext, input: { studentId: string; lineageId: string }): Promise<Result<boolean, AppError>> {
  return inReadTx(deps, ctx, async (tx) => ok(await enr.hasCompletedLineage(tx, input.studentId, input.lineageId)));
}
