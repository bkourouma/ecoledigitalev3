/**
 * Reconduction annuelle (US7) : `previewRollover` (sans écrire) puis `rolloverAcademicYear` (idempotent, par lots).
 *
 * La matrice « issue × niveau suivant » vient des DONNÉES (`enrollment_outcomes.kind`,
 * `grade_levels.next_grade_level_id`) : academic ne calcule aucune issue. Les inscriptions créées portent
 * `previous_enrollment_id`, `is_repeating` pour un redoublement et `source_kind = ROLLOVER` ; les financements dont le
 * type exige une référence d'affectation ne sont PAS reportés (listés dans le rapport).
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { Tx } from "@ecoledigitale/database";
import type { AcademicFundingCode, AcademicOutcomeKind, AcademicRolloverBody, AcademicRolloverPreviewDto, AcademicRolloverReportDto } from "@ecoledigitale/contracts/src/v2/academic";
import { classroomActivationProblem } from "../domain/classroom";
import { AcademicCode, conflict, validation } from "../domain/errors";
import { AcademicEvents } from "../domain/events";
import { planRollover, type RolloverAnomaly, type RolloverPlan, type RolloverSource, type RolloverTargetClassroom } from "../domain/rollover";
import type { AcademicYear, Classroom } from "../domain/records";
import { mapDbError } from "../infrastructure/db-errors";
import * as classroomsRepo from "../infrastructure/classroom-repository";
import * as cur from "../infrastructure/curriculum-repository";
import * as enr from "../infrastructure/enrollment-repository";
import * as ref from "../infrastructure/reference-repository";
import { loadYear } from "./calendar";
import { EventBuffer, inReadTx, inTx, type AcademicDeps } from "./deps";
import { checkStudentEnrollable, createEnrollmentInTx } from "./enrollments";
import type { PromotionDecision } from "./ports";

interface RolloverInputs {
  fromYear: AcademicYear;
  toYear: AcademicYear;
  plan: RolloverPlan;
  versionByProgram: Map<string, { id: string; status: string }>;
}

/** Issue (donnée du tenant) qui porte une décision de passage lue dans `results` : par nature, le code `PROMOTED` / `REPEATED` d'abord. */
const PREFERRED_OUTCOME_CODE: Readonly<Record<"ADVANCE" | "REPEAT" | "EXIT", string>> = { ADVANCE: "PROMOTED", REPEAT: "REPEATED", EXIT: "EXCLUDED" };

function outcomeCodeFor(catalog: ReadonlyArray<{ code: string; kind: AcademicOutcomeKind; active: boolean }>, kind: "ADVANCE" | "REPEAT" | "EXIT"): string | null {
  const candidates = catalog.filter((o) => o.active && o.kind === kind).sort((a, b) => Number(b.code === PREFERRED_OUTCOME_CODE[kind]) - Number(a.code === PREFERRED_OUTCOME_CODE[kind]) || a.code.localeCompare(b.code));
  return candidates[0]?.code ?? null;
}

/**
 * Décisions de passage CONFIRMÉES par `results` (port `PromotionDecisionPort`) pour les inscriptions de l'année source qui n'ont
 * pas d'issue enregistrée à la main. academic ne calcule rien : une inscription sans décision reste « issue manquante ».
 * Le port est appelé HORS de la transaction du plan (les ports ne s'entrelacent jamais avec une transaction ouverte).
 */
export async function loadPromotionDecisions(
  deps: AcademicDeps,
  ctx: RequestContext,
  fromYearId: string,
  classroomIds: readonly string[] | null | undefined,
): Promise<Result<Map<string, PromotionDecision>, AppError>> {
  const head = await inReadTx(deps, ctx, async (tx) => {
    const from = await loadYear(tx, ctx, fromYearId);
    if (!from.ok) return from;
    const rows = await enr.listRolloverSources(tx, from.value.id, from.value.institutionId, classroomIds ?? null);
    const pending = rows
      .filter((r) => r.enrollment.mode === "CLASS" && (r.enrollment.status === "ACTIVE" || r.enrollment.status === "COMPLETED") && !(r.enrollment.outcomeCode && r.outcomeKind))
      .map((r) => r.enrollment.id);
    return ok({ yearId: from.value.id, pending });
  });
  if (!head.ok) return head;
  const out = new Map<string, PromotionDecision>();
  for (let i = 0; i < head.value.pending.length; i += 500) {
    try {
      const found = await deps.ports.promotions.listDecisions(ctx, { academicYearId: head.value.yearId, enrollmentIds: head.value.pending.slice(i, i + 500) });
      for (const d of found) out.set(d.enrollmentId, d);
    } catch (e) {
      deps.logger.warn({ err: e instanceof Error ? e.message : String(e) }, "academic : décisions de passage illisibles (results indisponible) : issues manquantes signalées");
      break;
    }
  }
  return ok(out);
}

async function computePlan(
  tx: Tx,
  ctx: RequestContext,
  input: { fromYearId: string; body: AcademicRolloverBody },
  decisions: ReadonlyMap<string, PromotionDecision> = new Map(),
  /** Classes que l'assistant va créer (aperçu seulement) : comptées comme destinations possibles. */
  plannedClassrooms: readonly RolloverTargetClassroom[] = [],
): Promise<Result<RolloverInputs, AppError>> {
  const from = await loadYear(tx, ctx, input.fromYearId);
  if (!from.ok) return from;
  const to = await loadYear(tx, ctx, input.body.toAcademicYearId);
  if (!to.ok) return to;
  const fromYear = from.value;
  const toYear = to.value;
  if (fromYear.institutionId !== toYear.institutionId) return err(validation(AcademicCode.ROLLOVER_INVALID, "Les deux années doivent être du même établissement.", "toAcademicYearId"));
  if (toYear.startsOn <= fromYear.startsOn) return err(validation(AcademicCode.ROLLOVER_YEAR_ORDER, "L'année cible doit suivre l'année source.", "toAcademicYearId"));
  if (toYear.status !== "DRAFT" && toYear.status !== "OPEN") return err(conflict(AcademicCode.YEAR_NOT_OPEN, "L'année cible n'accepte plus d'inscription."));
  const institutionId = fromYear.institutionId;

  const [rows, gradeLevels, programs, funding, targetClassrooms, versions, rolled, outcomeCatalog] = await Promise.all([
    enr.listRolloverSources(tx, fromYear.id, institutionId, input.body.classroomIds ?? null),
    ref.listGradeLevels(tx),
    cur.listPrograms(tx, { institutionId }),
    ref.listFundingTypes(tx),
    classroomsRepo.listClassrooms(tx, { institutionId, academicYearId: toYear.id, limit: 200, offset: 0 }),
    cur.listVersions(tx, { yearId: toYear.id, institutionId }),
    enr.listRolledOverPreviousIds(tx, toYear.id, institutionId),
    ref.listOutcomes(tx),
  ]);
  // La liste paginée des classes cibles est lue en entier.
  const classrooms: Classroom[] = [...targetClassrooms.items];
  for (let offset = classrooms.length; offset < targetClassrooms.total; offset += 200) {
    classrooms.push(...(await classroomsRepo.listClassrooms(tx, { institutionId, academicYearId: toYear.id, limit: 200, offset })).items);
  }

  // Issue enregistrée sur l'inscription ; à défaut, décision de passage confirmée par `results` (lue par le port).
  const outcomeOf = (r: (typeof rows)[number]): RolloverSource["outcome"] => {
    if (r.enrollment.outcomeCode && r.outcomeKind) {
      return { code: r.enrollment.outcomeCode, kind: r.outcomeKind as AcademicOutcomeKind, targetProgramId: r.outcomeTargets?.targetProgramId ?? null, targetGradeLevelId: r.outcomeTargets?.targetGradeLevelId ?? null };
    }
    const decision = decisions.get(r.enrollment.id);
    const code = decision ? outcomeCodeFor(outcomeCatalog, decision.kind) : null;
    return decision && code ? { code, kind: decision.kind, targetProgramId: null, targetGradeLevelId: null } : null;
  };
  const sources: RolloverSource[] = rows.map((r) => ({
    enrollmentId: r.enrollment.id,
    studentId: r.enrollment.studentId,
    classroomId: r.enrollment.classroomId,
    programId: r.programId,
    gradeLevelId: r.gradeLevelId,
    mode: r.enrollment.mode,
    status: r.enrollment.status,
    fundingType: r.enrollment.fundingType,
    funderLabel: r.enrollment.funderLabel,
    outcome: outcomeOf(r),
  }));
  const versionByProgram = new Map(versions.map((v) => [v.programId, { id: v.id, status: v.status }]));
  const plan = planRollover(sources, {
    gradeLevels: new Map(gradeLevels.map((g) => [g.id, { id: g.id, code: g.code, label: g.label, nextGradeLevelId: g.nextGradeLevelId, isFinal: g.isFinal }])),
    programs: new Map(programs.map((p) => [p.id, { id: p.id, code: p.code, label: p.label, gradeLevelIds: new Set(p.gradeLevelIds) }])),
    fundingRequiresReference: new Map(funding.map((f) => [f.code, f.requiresReference])),
    targetClassrooms: classrooms.filter((c) => c.status === "DRAFT" || c.status === "ACTIVE").map((c) => ({ id: c.id, programId: c.programId, gradeLevelId: c.gradeLevelId, name: c.name, capacity: c.capacity, capacityIsHard: c.capacityIsHard, enrolledCount: c.enrolledCount })).concat(plannedClassrooms),
    programsWithPublishedCurriculum: new Set(versions.filter((v) => v.status === "PUBLISHED" || v.status === "LOCKED").map((v) => v.programId)),
    alreadyRolledOver: rolled,
    createMissingClassrooms: input.body.createMissingClassrooms ?? false,
  });
  return ok({ fromYear, toYear, plan, versionByProgram });
}

/** Aperçu SANS écriture : classes à créer, inscriptions à créer par issue, anomalies (AC7.1). */
export async function previewRollover(
  deps: AcademicDeps,
  ctx: RequestContext,
  fromYearId: string,
  body: AcademicRolloverBody,
  plannedClassrooms: readonly RolloverTargetClassroom[] = [],
): Promise<Result<AcademicRolloverPreviewDto, AppError>> {
  const decisions = await loadPromotionDecisions(deps, ctx, fromYearId, body.classroomIds);
  if (!decisions.ok) return decisions;
  return inReadTx(deps, ctx, async (tx) => {
    const r = await computePlan(tx, ctx, { fromYearId, body }, decisions.value, plannedClassrooms);
    if (!r.ok) return r;
    const { plan, fromYear, toYear } = r.value;
    return ok({
      fromAcademicYearId: fromYear.id,
      toAcademicYearId: toYear.id,
      classroomsToCreate: plan.classroomsToCreate.map((c) => ({ programId: c.programId, gradeLevelId: c.gradeLevelId, name: c.name, code: c.code })),
      enrollmentsToCreate: plan.enrollments.map((e) => ({
        previousEnrollmentId: e.previousEnrollmentId,
        studentId: e.studentId,
        outcomeKind: e.outcomeKind,
        targetProgramId: e.targetProgramId,
        targetGradeLevelId: e.targetGradeLevelId,
        isRepeating: e.isRepeating,
        fundingType: e.fundingType,
        carriesFunding: e.carriesFunding,
      })),
      alreadyRolledOver: plan.alreadyRolledOver,
      byOutcome: plan.byOutcome,
      anomalies: plan.anomalies,
    });
  });
}

class ItemFailure extends Error {
  constructor(readonly error: AppError) {
    super(error.message);
  }
}

/**
 * Reconduction annuelle IDEMPOTENTE : rejouée, elle ne crée rien en double (`previous_enrollment_id`, index unique
 * partiel). Les classes manquantes sont créées si demandé ; les inscriptions le sont par lots (une transaction par
 * lot, un point de sauvegarde par inscription : un échec n'arrête pas le lot). Opération sensible : auditée.
 */
export interface EnrollmentRolloverOptions {
  /** `false` : ni événement `academic.rollover.completed` ni audit (l'assistant les écrit une fois, pour l'ensemble des étapes). */
  finalize?: boolean;
  /** Appelé après chaque lot d'inscriptions (`done` / `total` = inscriptions planifiées). */
  onProgress?: (done: number, total: number) => Promise<void> | void;
}

export async function rolloverAcademicYear(
  deps: AcademicDeps,
  ctx: RequestContext,
  fromYearId: string,
  body: AcademicRolloverBody,
  options: EnrollmentRolloverOptions = {},
): Promise<Result<AcademicRolloverReportDto, AppError>> {
  const decisions = await loadPromotionDecisions(deps, ctx, fromYearId, body.classroomIds);
  if (!decisions.ok) return decisions;
  // 1. Classes à créer (une transaction), puis le plan définitif.
  const prepared = await inTx<{ inputs: RolloverInputs; classroomIds: Map<string, string>; created: number }>(deps, ctx, async (tx) => {
    const r = await computePlan(tx, ctx, { fromYearId, body }, decisions.value);
    if (!r.ok) return r;
    const classroomIds = new Map<string, string>();
    for (const c of r.value.plan.classroomsToCreate) {
      const version = r.value.versionByProgram.get(c.programId);
      const published = version && (version.status === "PUBLISHED" || version.status === "LOCKED");
      const problem = classroomActivationProblem({ curriculumVersionId: version?.id ?? null, versionStatus: version?.status ?? null });
      const id = deps.newId();
      await classroomsRepo.insertClassroom(tx, {
        id,
        institutionId: r.value.toYear.institutionId,
        campusId: ctx.campusId ?? null,
        academicYearId: r.value.toYear.id,
        programId: c.programId,
        gradeLevelId: c.gradeLevelId,
        curriculumVersionId: published ? (version?.id ?? null) : null,
        kind: "CLASS",
        code: c.code,
        name: c.name,
        capacity: null,
        capacityIsHard: true,
        startsOn: null,
        endsOn: null,
        status: problem === null ? "ACTIVE" : "DRAFT",
      });
      classroomIds.set(c.key, id);
    }
    return ok({ inputs: r.value, classroomIds, created: classroomIds.size });
  });
  if (!prepared.ok) return prepared;
  const { inputs, classroomIds } = prepared.value;
  const { plan, fromYear, toYear } = inputs;

  const anomalies: RolloverAnomaly[] = [...plan.anomalies];
  let enrollmentsCreated = 0;
  let alreadyRolledOver = plan.alreadyRolledOver;
  let skipped = 0;
  const enrolledOn = toYear.startsOn;

  // 2. Inscriptions, par lots.
  for (let start = 0; start < plan.enrollments.length; start += deps.config.rolloverBatchSize) {
    const batch = plan.enrollments.slice(start, start + deps.config.rolloverBatchSize);
    const result = await inTx<{ created: number; already: number; skipped: number; anomalies: RolloverAnomaly[] }>(deps, ctx, async (tx) => {
      const events = new EventBuffer(deps, ctx);
      const out = { created: 0, already: 0, skipped: 0, anomalies: [] as RolloverAnomaly[] };
      for (const item of batch) {
        const classroomId = item.targetClassroomId ?? (item.plannedClassroomKey ? classroomIds.get(item.plannedClassroomKey) : undefined);
        if (!classroomId) {
          out.skipped += 1;
          out.anomalies.push({ code: "target_classroom_missing", enrollmentId: item.previousEnrollmentId, classroomId: null, message: "Classe de destination introuvable." });
          continue;
        }
        const student = await checkStudentEnrollable(deps, ctx, item.studentId);
        if (!student.ok) {
          out.skipped += 1;
          out.anomalies.push({ code: "student_not_enrollable", enrollmentId: item.previousEnrollmentId, classroomId, message: student.error.message });
          continue;
        }
        try {
          await tx.transaction(async (sp) => {
            const r = await createEnrollmentInTx(
              deps,
              ctx,
              sp,
              events,
              {
                studentId: item.studentId,
                classroomId,
                mode: "CLASS",
                enrolledOn,
                fundingType: item.fundingType as AcademicFundingCode,
                funderLabel: item.funderLabel,
                isRepeating: item.isRepeating,
                previousEnrollmentId: item.previousEnrollmentId,
                sourceKind: "ROLLOVER",
              },
              student.value,
            );
            if (!r.ok) throw new ItemFailure(r.error);
          });
          out.created += 1;
        } catch (e) {
          const failure = e instanceof ItemFailure ? e.error : mapDbError(e);
          if (!failure) throw e;
          if (failure.code === AcademicCode.ALREADY_ENROLLED) out.already += 1;
          else {
            out.skipped += 1;
            out.anomalies.push({ code: failure.code === AcademicCode.CLASSROOM_FULL ? "target_classroom_full" : "enrollment_failed", enrollmentId: item.previousEnrollmentId, classroomId, message: failure.message });
          }
        }
      }
      await events.flush(tx);
      return ok(out);
    });
    if (!result.ok) return result;
    enrollmentsCreated += result.value.created;
    alreadyRolledOver += result.value.already;
    skipped += result.value.skipped;
    anomalies.push(...result.value.anomalies);
    await options.onProgress?.(Math.min(start + batch.length, plan.enrollments.length), plan.enrollments.length);
  }

  // 3. Rapport, événement et audit (opération sensible).
  const report: AcademicRolloverReportDto = {
    fromAcademicYearId: fromYear.id,
    toAcademicYearId: toYear.id,
    classroomsCreated: prepared.value.created,
    enrollmentsCreated,
    alreadyRolledOver,
    skipped,
    anomalies,
  };
  if (options.finalize === false) return ok(report);
  const final = await inTx<null>(deps, ctx, async (tx) => {
    const events = new EventBuffer(deps, ctx);
    events.add(
      AcademicEvents.ROLLOVER_COMPLETED,
      { v: 1, institutionId: fromYear.institutionId, fromAcademicYearId: fromYear.id, toAcademicYearId: toYear.id, enrollmentsCreated, classroomsCreated: report.classroomsCreated },
      { type: "academic_year", id: toYear.id },
    );
    events.audit({
      action: "academic.year.rollover",
      resourceType: "academic_year",
      resourceId: toYear.id,
      sensitive: true,
      after: { fromAcademicYearId: fromYear.id, enrollmentsCreated, classroomsCreated: report.classroomsCreated, alreadyRolledOver, skipped, anomalies: anomalies.length },
    });
    await events.flush(tx);
    return ok(null);
  });
  if (!final.ok) return final;
  return ok(report);
}
