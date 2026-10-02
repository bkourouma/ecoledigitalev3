/**
 * Lectures publiées pour les autres modules : effectif (`getRoster`), nœuds suivis (`listNodesForClassroom` /
 * `listNodesForEnrollment`), faits pour le moteur de règles (`getRuleContext`), registre d'inscriptions aux cours,
 * annuaire d'inscriptions pour la finance, portails élève/parent, catalogue à la carte.
 *
 * Seules les inscriptions `ACTIVE`/`COMPLETED` et les sélections `CONFIRMED`/`COMPLETED` ouvrent présences, notes et
 * bulletins (G-04) : cet ensemble est défini UNE fois dans le domaine.
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { Tx } from "@ecoledigitale/database";
import type { ACADEMIC_ELIGIBILITY_CODES } from "@ecoledigitale/contracts/src/v2/academic";
import type {
  AcademicCatalogItemDto,
  AcademicCourseRegistrationDto,
  AcademicEnrollmentNodeView,
  AcademicEnrollmentRefDto,
  AcademicRosterDto,
  AcademicRuleContext,
} from "@ecoledigitale/contracts/src/v2/academic";
import { effectivePeriodState } from "../domain/calendar";
import { ancestorsOf, descendantsOf, followedNodes, type FollowedNode, type FollowedSelection, type PeriodChainItem } from "../domain/curriculum";
import { SCHOOLING_COURSE_STATUSES, SCHOOLING_ENROLLMENT_STATUSES, opensSchooling } from "../domain/enrollment";
import { AcademicCode, forbidden, notFound } from "../domain/errors";
import { buildRuleContext } from "../domain/rule-context";
import type { AcademicPeriod, Classroom, CurriculumNode, Enrollment, NodeType, Offering } from "../domain/records";
import * as cal from "../infrastructure/calendar-repository";
import * as classroomsRepo from "../infrastructure/classroom-repository";
import * as cur from "../infrastructure/curriculum-repository";
import * as enr from "../infrastructure/enrollment-repository";
import * as ref from "../infrastructure/reference-repository";
import { loadClassroomInScope } from "./calendar";
import { inReadTx, inScope, todayFor, type AcademicDeps } from "./deps";
import { loadEnrollmentInScope } from "./enrollment-core";
import { evaluateForStudent } from "./courses";

const asRules = (t: NodeType): NodeType => t;

// ---------------------------------------------------------------------------
// Nœuds suivis
// ---------------------------------------------------------------------------

export async function periodChainOf(tx: Tx, periodId: string): Promise<{ chain: PeriodChainItem[]; period: AcademicPeriod; all: AcademicPeriod[] } | null> {
  const period = await cal.getPeriod(tx, periodId);
  if (!period) return null;
  const all = await cal.listPeriods(tx, period.academicYearId);
  const byId = new Map(all.map((p) => [p.id, p]));
  const chain: PeriodChainItem[] = [];
  let cursor: AcademicPeriod | undefined = period;
  let guard = 0;
  while (cursor && guard < 5) {
    chain.push({ typeCode: cursor.periodTypeCode, ordinal: cursor.ordinal });
    cursor = cursor.parentPeriodId ? byId.get(cursor.parentPeriodId) : undefined;
    guard += 1;
  }
  return { chain, period, all };
}

async function loadFollowed(
  tx: Tx,
  enrollment: Enrollment,
  classroom: Classroom,
  chain: readonly PeriodChainItem[] | undefined,
): Promise<{ followed: FollowedNode[]; nodes: CurriculumNode[]; types: NodeType[] }> {
  if (!classroom.curriculumVersionId) return { followed: [], nodes: [], types: [] };
  const nodes = await cur.listNodes(tx, classroom.curriculumVersionId);
  const types = await ref.listNodeTypes(tx);
  const selections: FollowedSelection[] = (await enr.listSelectionsOfEnrollment(tx, enrollment.id, SCHOOLING_COURSE_STATUSES)).map((c) => ({ nodeId: c.curriculumNodeId, courseId: c.id, source: c.source }));
  const followed = followedNodes({
    nodes,
    nodeTypes: types.map(asRules),
    mode: enrollment.mode,
    classGradeLevelId: classroom.gradeLevelId,
    selections,
    ...(chain ? { periodChain: chain } : {}),
  });
  return { followed, nodes, types };
}

const toNodeView = (f: FollowedNode): AcademicEnrollmentNodeView => ({
  nodeId: f.node.id,
  lineageId: f.node.lineageId,
  parentId: f.node.parentId,
  nodeTypeCode: f.node.nodeTypeCode,
  code: f.node.code,
  label: f.node.label,
  subjectId: f.node.subjectId,
  coefficient: f.node.coefficient,
  credits: f.node.credits,
  isMandatory: f.node.isMandatory,
  isTransversal: f.node.isTransversal,
  categoryCode: f.node.categoryCode,
  periodTypeCode: f.node.periodTypeCode,
  periodOrdinal: f.node.periodOrdinal,
  registrationKind: f.kind,
  enrollmentCourseId: f.enrollmentCourseId,
});

/** Nœuds suivis par l'inscription (obligatoires de la classe + sélections confirmées), transversaux INCLUS. */
export async function listNodesForEnrollment(deps: AcademicDeps, ctx: RequestContext, enrollmentId: string, options: { periodId?: string | null } = {}): Promise<Result<AcademicEnrollmentNodeView[], AppError>> {
  return inReadTx(deps, ctx, async (tx) => {
    const e = await loadEnrollmentInScope(tx, ctx, enrollmentId);
    if (!e.ok) return e;
    if (!opensSchooling(e.value.status)) return ok([]);
    const classroom = (await classroomsRepo.getClassroom(tx, e.value.classroomId)) as Classroom;
    let chain: PeriodChainItem[] | undefined;
    if (options.periodId) {
      const p = await periodChainOf(tx, options.periodId);
      if (!p) return err(notFound(AcademicCode.PERIOD_NOT_FOUND, "Période", options.periodId));
      chain = p.chain;
    }
    const { followed } = await loadFollowed(tx, e.value, classroom, chain);
    return ok(followed.map(toNodeView));
  });
}

/** Nœuds obligatoires d'une classe (structure suivie par tous ses inscrits en mode « classe »). */
export async function listNodesForClassroom(deps: AcademicDeps, ctx: RequestContext, classroomId: string, options: { periodId?: string | null } = {}): Promise<Result<AcademicEnrollmentNodeView[], AppError>> {
  return inReadTx(deps, ctx, async (tx) => {
    const c = await loadClassroomInScope(tx, ctx, classroomId);
    if (!c.ok) return c;
    const classroom = c.value;
    if (!classroom.curriculumVersionId) return ok([]);
    let chain: PeriodChainItem[] | undefined;
    if (options.periodId) {
      const p = await periodChainOf(tx, options.periodId);
      if (!p) return err(notFound(AcademicCode.PERIOD_NOT_FOUND, "Période", options.periodId));
      chain = p.chain;
    }
    const nodes = await cur.listNodes(tx, classroom.curriculumVersionId);
    const types = await ref.listNodeTypes(tx);
    const followed = followedNodes({ nodes, nodeTypes: types.map(asRules), mode: "CLASS", classGradeLevelId: classroom.gradeLevelId, selections: [], ...(chain ? { periodChain: chain } : {}) });
    return ok(followed.map(toNodeView));
  });
}

// ---------------------------------------------------------------------------
// Registre d'inscriptions aux cours (`course_registrations`, 011 / 019)
// ---------------------------------------------------------------------------

/**
 * Registre LOGIQUE des inscriptions aux cours : les nœuds inscriptibles suivis par l'inscription, avec leur nature
 * (`REGULAR` pour le tronc de la classe, `OPTION`, `A_LA_CARTE`, `CARRY_OVER`, `RESIT`) et le statut de la sélection.
 */
export async function listCourseRegistrations(deps: AcademicDeps, ctx: RequestContext, input: { enrollmentId: string; periodId?: string | null }): Promise<Result<AcademicCourseRegistrationDto[], AppError>> {
  return inReadTx(deps, ctx, async (tx) => {
    const e = await loadEnrollmentInScope(tx, ctx, input.enrollmentId);
    if (!e.ok) return e;
    const enrollment = e.value;
    const classroom = (await classroomsRepo.getClassroom(tx, enrollment.classroomId)) as Classroom;
    let chain: PeriodChainItem[] | undefined;
    if (input.periodId) {
      const p = await periodChainOf(tx, input.periodId);
      if (!p) return err(notFound(AcademicCode.PERIOD_NOT_FOUND, "Période", input.periodId));
      chain = p.chain;
    }
    const { followed, types } = await loadFollowed(tx, enrollment, classroom, chain);
    const enrollable = new Set(types.filter((t) => t.isEnrollable).map((t) => t.code));
    const courses = new Map((await enr.listCourses(tx, enrollment.id)).map((c) => [c.id, c]));
    const rows: AcademicCourseRegistrationDto[] = [];
    for (const f of followed) {
      const course = f.enrollmentCourseId ? courses.get(f.enrollmentCourseId) : undefined;
      if (!enrollable.has(f.node.nodeTypeCode) && !(course && course.curriculumNodeId === f.node.id)) continue;
      rows.push({
        enrollmentId: enrollment.id,
        studentId: enrollment.studentId,
        nodeId: f.node.id,
        lineageId: f.node.lineageId,
        kind: f.kind,
        status: course?.status ?? "CONFIRMED",
        enrollmentCourseId: f.enrollmentCourseId,
        offeringId: course?.offeringId ?? null,
      });
    }
    return ok(rows);
  });
}

// ---------------------------------------------------------------------------
// Effectif
// ---------------------------------------------------------------------------

/**
 * Effectif d'une classe à une date : inscriptions dont un PLACEMENT dans la classe couvre la date (un transfert
 * déplace l'élève sans le dupliquer) et dont le statut ouvre la scolarité ; `nodeId` restreint aux élèves qui
 * suivent ce nœud (tronc de la classe ou sélection confirmée sur le nœud, un de ses ancêtres ou descendants).
 */
export async function getRoster(deps: AcademicDeps, ctx: RequestContext, classroomId: string, options: { onDate?: string | null; nodeId?: string | null } = {}): Promise<Result<AcademicRosterDto, AppError>> {
  return inReadTx(deps, ctx, async (tx) => {
    const c = await loadClassroomInScope(tx, ctx, classroomId);
    if (!c.ok) return c;
    const classroom = c.value;
    const onDate = options.onDate ?? (await todayFor(deps, ctx, classroom.institutionId));
    const rows = await enr.rosterOfClassroom(tx, classroomId, onDate, SCHOOLING_ENROLLMENT_STATUSES, SCHOOLING_COURSE_STATUSES);

    let follows: ((row: { enrollment: Enrollment; selectionNodeIds: string[] }) => boolean) | null = null;
    if (options.nodeId) {
      if (!classroom.curriculumVersionId) return ok({ classroomId, onDate, items: [] });
      const nodes = await cur.listNodes(tx, classroom.curriculumVersionId);
      if (!nodes.some((n) => n.id === options.nodeId)) return err(notFound(AcademicCode.NODE_NOT_FOUND, "Nœud de curriculum", options.nodeId));
      const types = await ref.listNodeTypes(tx);
      const trunk = new Set(followedNodes({ nodes, nodeTypes: types.map(asRules), mode: "CLASS", classGradeLevelId: classroom.gradeLevelId, selections: [] }).map((f) => f.node.id));
      const byId = new Map(nodes.map((n) => [n.id, n]));
      const related = new Set([options.nodeId, ...ancestorsOf(options.nodeId, byId), ...descendantsOf(options.nodeId, nodes)]);
      follows = (row) => (row.enrollment.mode === "CLASS" && trunk.has(options.nodeId as string)) || row.selectionNodeIds.some((id) => related.has(id));
    }
    const items = rows
      .filter((r) => (follows ? follows(r) : true))
      .map((r) => ({
        enrollmentId: r.enrollment.id,
        studentId: r.enrollment.studentId,
        mode: r.enrollment.mode,
        status: r.enrollment.status,
        registrationNumber: r.enrollment.registrationNumber,
        fundingType: r.enrollment.fundingType,
        isRepeating: r.enrollment.isRepeating,
        confirmedNodeIds: r.selectionNodeIds,
      }));
    return ok({ classroomId, onDate, items });
  });
}

// ---------------------------------------------------------------------------
// Faits pour le moteur de règles
// ---------------------------------------------------------------------------

export async function getRuleContext(deps: AcademicDeps, ctx: RequestContext, input: { enrollmentId: string; periodId?: string | null }): Promise<Result<AcademicRuleContext, AppError>> {
  return inReadTx(deps, ctx, async (tx) => {
    const e = await loadEnrollmentInScope(tx, ctx, input.enrollmentId);
    if (!e.ok) return e;
    const enrollment = e.value;
    const classroom = (await classroomsRepo.getClassroom(tx, enrollment.classroomId)) as Classroom;
    const program = await cur.getProgram(tx, classroom.programId);
    const grade = await ref.getGradeLevel(tx, classroom.gradeLevelId);
    if (!program || !grade) return err(notFound(AcademicCode.PROGRAM_NOT_FOUND, "Programme ou niveau de la classe"));
    const [educationLevel, nextGrade, parentProgram] = await Promise.all([
      ref.getEducationLevel(tx, grade.educationLevelId),
      grade.nextGradeLevelId ? ref.getGradeLevel(tx, grade.nextGradeLevelId) : Promise.resolve(null),
      program.parentProgramId ? cur.getProgram(tx, program.parentProgramId) : Promise.resolve(null),
    ]);
    let periodInput: Parameters<typeof buildRuleContext>[0]["period"] = null;
    let chain: PeriodChainItem[] | undefined;
    if (input.periodId) {
      const p = await periodChainOf(tx, input.periodId);
      if (!p || p.period.academicYearId !== classroom.academicYearId) return err(notFound(AcademicCode.PERIOD_NOT_FOUND, "Période", input.periodId));
      chain = p.chain;
      const explicit = (await cal.effectiveState(tx, classroom.id, p.period.id)) ?? { state: p.period.status, explicit: false };
      const parent = p.period.parentPeriodId ? p.all.find((x) => x.id === p.period.parentPeriodId) : undefined;
      periodInput = {
        period: p.period,
        allPeriodsOfYear: p.all,
        periodTypes: await ref.listPeriodTypes(tx),
        parentTypeCode: parent?.periodTypeCode ?? null,
        effectiveState: effectivePeriodState(p.period.status, explicit.explicit ? (explicit.state as "OPEN" | "GRADING_CLOSED" | "CLOSED") : null),
      };
    }
    const { followed } = opensSchooling(enrollment.status) ? await loadFollowed(tx, enrollment, classroom, chain) : { followed: [] as FollowedNode[] };
    const institution = await deps.ports.institutions.getInstitution(ctx, enrollment.institutionId);
    return ok(
      buildRuleContext({
        enrollment,
        pack: educationLevel?.pack ?? institution?.pack ?? null,
        educationLevel: { code: educationLevel?.code ?? "", ordinal: educationLevel?.ordinal ?? 0 },
        gradeLevel: { code: grade.code, ordinal: grade.ordinal, isFinal: grade.isFinal, nextGradeLevelCode: nextGrade?.code ?? null },
        program: { code: program.code, kindCode: program.kindCode, domainCode: program.domainCode, parentProgramCode: parentProgram?.code ?? null },
        period: periodInput,
        nodes: followed,
      }),
    );
  });
}

// ---------------------------------------------------------------------------
// Annuaire pour la finance (port `EnrollmentDirectory`)
// ---------------------------------------------------------------------------

/**
 * Adaptateur conforme au port `EnrollmentDirectory` de finance :
 * `learnerId` = apprenant ; `academicYear` = code de l'année ; `groupKey`/`groupLabel` = classe ; `levelKey` = code du
 * niveau ; `trackKey` = code du programme ; `learnerType` = type de financement. Champs additifs demandés à finance
 * (spec 004 §7.4a) : `fundingType`, `fundingReference`, `registrationNumber`.
 */
export function createEnrollmentDirectory(deps: AcademicDeps): { getEnrollment(ctx: RequestContext, enrollmentId: string): Promise<AcademicEnrollmentRefDto | null> } {
  return {
    async getEnrollment(ctx, enrollmentId) {
      const r = await inReadTx(deps, ctx, async (tx) => {
        const e = await enr.getEnrollment(tx, enrollmentId);
        if (!e || !inScope(ctx, e)) return ok<AcademicEnrollmentRefDto | null>(null);
        const [year, classroom] = await Promise.all([cal.getYear(tx, e.academicYearId), classroomsRepo.getClassroom(tx, e.classroomId)]);
        const [program, grade] = classroom ? await Promise.all([cur.getProgram(tx, classroom.programId), ref.getGradeLevel(tx, classroom.gradeLevelId)]) : [null, null];
        return ok<AcademicEnrollmentRefDto | null>({
          enrollmentId: e.id,
          learnerId: e.studentId,
          academicYear: year?.code ?? "",
          groupKey: classroom?.id ?? null,
          groupLabel: classroom?.name ?? null,
          institutionId: e.institutionId,
          campusId: e.campusId,
          levelKey: grade?.code ?? null,
          trackKey: program?.code ?? null,
          learnerType: e.fundingType,
          fundingType: e.fundingType,
          fundingReference: e.assignmentReference,
          registrationNumber: e.registrationNumber,
        });
      });
      return r.ok ? r.value : null;
    },
  };
}

// ---------------------------------------------------------------------------
// Portails : « mes inscriptions » (élève) et « inscriptions de mon enfant » (parent)
// ---------------------------------------------------------------------------

export async function listMyEnrollments(deps: AcademicDeps, ctx: RequestContext): Promise<Result<Enrollment[], AppError>> {
  if (!ctx.userId) return err(forbidden(AcademicCode.FORBIDDEN_SCOPE, "Un utilisateur est requis."));
  const lookup = deps.ports.students.findStudentByUserId;
  const mine = lookup ? await lookup.call(deps.ports.students, ctx, ctx.userId) : null;
  if (!mine) return ok([]);
  return inReadTx(deps, ctx, async (tx) => ok((await enr.listEnrollmentsByStudent(tx, mine.studentId)).filter((e) => inScope(ctx, e))));
}

/** Un parent ne lit que les inscriptions de ses enfants (`people.isGuardianOfStudent`) ; hors lien : 404, jamais 403. */
export async function listChildEnrollments(deps: AcademicDeps, ctx: RequestContext, studentId: string): Promise<Result<Enrollment[], AppError>> {
  if (!ctx.userId) return err(forbidden(AcademicCode.FORBIDDEN_SCOPE, "Un utilisateur est requis."));
  const allowed = await deps.ports.guardianship.isGuardianOfStudent(ctx, ctx.userId, studentId);
  if (!allowed) return err(notFound(AcademicCode.STUDENT_NOT_FOUND, "Apprenant", studentId));
  return inReadTx(deps, ctx, async (tx) => ok((await enr.listEnrollmentsByStudent(tx, studentId)).filter((e) => inScope(ctx, e))));
}

// ---------------------------------------------------------------------------
// Catalogue à la carte
// ---------------------------------------------------------------------------

/** Offres ouvertes à l'inscription avec places restantes, prérequis et, si un apprenant est désigné, son éligibilité. */
export async function getCatalog(deps: AcademicDeps, ctx: RequestContext, input: { institutionId?: string | null; programId?: string | null; studentId?: string | null } = {}): Promise<Result<AcademicCatalogItemDto[], AppError>> {
  return inReadTx(deps, ctx, async (tx) => {
    const institutionId = input.institutionId ?? ctx.institutionId ?? null;
    const offerings = await classroomsRepo.listOfferings(tx, { institutionId, programId: input.programId ?? null, openForRegistration: true });
    const items: AcademicCatalogItemDto[] = [];
    for (const offering of offerings) {
      const classroom = await classroomsRepo.getClassroom(tx, offering.classroomId);
      if (!classroom || !inScope(ctx, classroom)) continue;
      const node = await cur.getNode(tx, offering.curriculumNodeId);
      if (!node || node.isTransversal) continue;
      items.push(await catalogItem(deps, ctx, tx, offering, classroom, node, input.studentId ?? null));
    }
    return ok(items);
  });
}

async function catalogItem(deps: AcademicDeps, ctx: RequestContext, tx: Tx, offering: Offering, classroom: Classroom, node: CurriculumNode, studentId: string | null): Promise<AcademicCatalogItemDto> {
  const eligibility = studentId ? await evaluateForStudent(deps, ctx, tx, offering, classroom, studentId) : null;
  return {
    offering,
    node: { id: node.id, lineageId: node.lineageId, code: node.code, label: node.label, credits: node.credits, coefficient: node.coefficient },
    classroomName: classroom.name,
    programId: classroom.programId,
    remainingPlaces: offering.capacity === null ? null : Math.max(0, offering.capacity - offering.heldPlaces),
    prerequisiteLineageIds: node.prerequisiteLineageIds,
    eligibility: eligibility
      ? {
          offeringId: offering.id,
          studentId: studentId as string,
          eligible: eligibility.eligible,
          code: (eligibility.failure?.code ?? null) as (typeof ACADEMIC_ELIGIBILITY_CODES)[number] | null,
          message: eligibility.failure?.message ?? null,
          missingPrerequisiteLineageIds: eligibility.missingPrerequisites,
          warnings: eligibility.warnings,
          remainingPlaces: eligibility.remainingPlaces,
        }
      : null,
  };
}
