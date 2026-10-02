/**
 * Assistant de reconduction annuelle (spec 004 §9) : aperçu de ce qui sera copié, exécution IDEMPOTENTE en tâche de fond
 * (worker) avec progression, rapport.
 *
 *   1. PERIODS      périodes de l'année cible (types, numéros, codes, libellés ; dates reportées et bornées) ;
 *   2. HOLIDAYS     jours fériés / fermetures marqués `recursYearly` (même date civile) ;
 *   3. CURRICULUM   version PUBLIÉE (ou verrouillée) de chaque programme -> BROUILLON de l'année cible (lignées conservées) ;
 *   4. CLASSROOMS   classes de l'année source -> classes en BROUILLON de l'année cible (codes, noms, capacités) ;
 *   5. OFFERINGS    offres à la carte des classes reconduites -> offres en BROUILLON (nœuds retrouvés par LIGNÉE) ;
 *   6. ENROLLMENTS  réinscriptions : la décision de passage vient de l'inscription (issue enregistrée) ou de `results` par le
 *                   port `PromotionDecisionPort` — academic ne décide jamais du passage d'un élève.
 *
 * Rien n'est écrasé : une période, un jour férié, un curriculum, une classe, une offre ou une inscription déjà présents sont
 * comptés (« déjà fait ») et laissés intacts, donc relancer une reconduction (après une panne, ou pour compléter) est sûr.
 * La requête HTTP n'exécute RIEN : elle enregistre l'exécution et publie `academic.rollover.requested` ; le worker la reprend.
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { Tx } from "@ecoledigitale/database";
import type {
  AcademicRolloverPlanDto,
  AcademicRolloverPlanQuery,
  AcademicRolloverRunBody,
  AcademicRolloverRunDto,
  AcademicRolloverRunReport,
  AcademicRolloverStep,
  AcademicRolloverWarning,
} from "@ecoledigitale/contracts/src/v2/academic";
import { ACADEMIC_ROLLOVER_STEPS } from "@ecoledigitale/contracts/src/v2/academic";
import { AcademicCode, conflict, notFound, validation } from "../domain/errors";
import { AcademicEvents } from "../domain/events";
import type { RolloverAnomaly } from "../domain/rollover";
import type { AcademicYear, Classroom, CurriculumNode, CurriculumVersion, Program } from "../domain/records";
import {
  classroomCodeKey,
  planClassrooms,
  planHolidays,
  planPeriods,
  shiftOffering,
  type PlannedClassroom,
  type SourceClassroom,
} from "../domain/structure-rollover";
import * as cal from "../infrastructure/calendar-repository";
import * as classroomsRepo from "../infrastructure/classroom-repository";
import * as cur from "../infrastructure/curriculum-repository";
import * as repo from "../infrastructure/rollover-repository";
import { createPeriod, loadYear } from "./calendar";
import { createClassroom, createOffering } from "./classrooms";
import { cloneCurriculumVersion } from "./curriculum";
import { EventBuffer, inReadTx, inTx, type AcademicDeps } from "./deps";
import { previewRollover, rolloverAcademicYear } from "./rollover";

/** Une exécution `RUNNING` sans mise à jour depuis ce délai est considérée comme interrompue (reprise possible). */
export const ROLLOVER_STALE_AFTER_MS = 10 * 60_000;

export interface RolloverAssistOptions {
  /** La fonction « à la carte » est-elle incluse dans l'offre du tenant ? Sinon l'étape OFFERINGS est retirée (avec avertissement). */
  offeringsEnabled?: boolean;
}

// ---------------------------------------------------------------------------------------------------------------------
// Outils communs
// ---------------------------------------------------------------------------------------------------------------------

const warn = (code: AcademicRolloverWarning["code"], step: AcademicRolloverStep | null, message: string): AcademicRolloverWarning => ({ code, step, message });

/** Étapes retenues : ordre canonique, sans doublon ; OFFERINGS retirée si la fonction n'est pas incluse. */
export function normalizeSteps(requested: readonly AcademicRolloverStep[] | undefined, offeringsEnabled: boolean): { steps: AcademicRolloverStep[]; warnings: AcademicRolloverWarning[] } {
  const wanted = new Set<AcademicRolloverStep>(requested && requested.length > 0 ? requested : ACADEMIC_ROLLOVER_STEPS);
  const warnings: AcademicRolloverWarning[] = [];
  if (wanted.has("OFFERINGS") && !offeringsEnabled) {
    wanted.delete("OFFERINGS");
    warnings.push(warn("offerings_feature_disabled", "OFFERINGS", "Les offres à la carte ne sont pas incluses dans l'offre de l'établissement : cette étape est ignorée."));
  }
  return { steps: ACADEMIC_ROLLOVER_STEPS.filter((s) => wanted.has(s)), warnings };
}

async function loadYearPair(tx: Tx, ctx: RequestContext, fromId: string, toId: string): Promise<Result<{ from: AcademicYear; to: AcademicYear }, AppError>> {
  const from = await loadYear(tx, ctx, fromId);
  if (!from.ok) return from;
  const to = await loadYear(tx, ctx, toId);
  if (!to.ok) return to;
  if (from.value.institutionId !== to.value.institutionId) return err(validation(AcademicCode.ROLLOVER_INVALID, "Les deux années doivent être du même établissement.", "toAcademicYearId"));
  if (to.value.startsOn <= from.value.startsOn) return err(validation(AcademicCode.ROLLOVER_YEAR_ORDER, "L'année cible doit suivre l'année source.", "toAcademicYearId"));
  if (to.value.status !== "DRAFT" && to.value.status !== "OPEN") return err(conflict(AcademicCode.YEAR_NOT_OPEN, "L'année cible n'accepte plus de modification."));
  return ok({ from: from.value, to: to.value });
}

async function allClassrooms(tx: Tx, institutionId: string, yearId: string): Promise<Classroom[]> {
  const out: Classroom[] = [];
  for (let offset = 0; ; offset += 200) {
    const page = await classroomsRepo.listClassrooms(tx, { institutionId, academicYearId: yearId, limit: 200, offset });
    out.push(...page.items);
    if (out.length >= page.total || page.items.length === 0) break;
  }
  return out;
}

const toSourceClassroom = (c: Classroom): SourceClassroom => ({
  id: c.id,
  programId: c.programId,
  gradeLevelId: c.gradeLevelId,
  kind: c.kind,
  code: c.code,
  name: c.name,
  capacity: c.capacity,
  capacityIsHard: c.capacityIsHard,
  campusId: c.campusId,
  startsOn: c.startsOn,
  endsOn: c.endsOn,
  status: c.status,
});

/** Version à reconduire pour un programme : publiée ou verrouillée ; la plus récente si plusieurs. */
function sourceVersionOf(versions: readonly CurriculumVersion[], programId: string): CurriculumVersion | null {
  const mine = versions.filter((v) => v.programId === programId && v.status !== "ARCHIVED");
  return mine.find((v) => v.status === "PUBLISHED" || v.status === "LOCKED") ?? mine[0] ?? null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Aperçu
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Aperçu SANS écriture de tout ce qui sera copié, avec les avertissements (années déjà peuplées, conflits, curriculum
 * manquant, jours non reconductibles, décisions de passage manquantes).
 */
export async function previewRolloverPlan(
  deps: AcademicDeps,
  ctx: RequestContext,
  fromYearId: string,
  query: AcademicRolloverPlanQuery,
  options: RolloverAssistOptions = {},
): Promise<Result<AcademicRolloverPlanDto, AppError>> {
  const { steps, warnings: stepWarnings } = normalizeSteps(query.steps, options.offeringsEnabled ?? true);
  const warnings: AcademicRolloverWarning[] = [...stepWarnings];

  const base = await inReadTx(deps, ctx, async (tx) => {
    const years = await loadYearPair(tx, ctx, fromYearId, query.toAcademicYearId);
    if (!years.ok) return years;
    const { from, to } = years.value;
    const institutionId = from.institutionId;
    const [fromPeriods, toPeriods, holidays, programs, fromVersions, toVersions, fromClassrooms, toClassrooms, live] = await Promise.all([
      cal.listPeriods(tx, from.id),
      cal.listPeriods(tx, to.id),
      repo.listHolidays(tx, { institutionId }),
      cur.listPrograms(tx, { institutionId, status: "ACTIVE" }),
      cur.listVersions(tx, { yearId: from.id, institutionId }),
      cur.listVersions(tx, { yearId: to.id, institutionId }),
      allClassrooms(tx, institutionId, from.id),
      allClassrooms(tx, institutionId, to.id),
      repo.findLiveRun(tx, from.id, to.id),
    ]);
    const offeringsBySource = new Map<string, number>();
    const offeringsByTarget = new Map<string, number>();
    if (steps.includes("OFFERINGS")) {
      for (const c of fromClassrooms) {
        const offerings = await classroomsRepo.listOfferings(tx, { classroomId: c.id });
        offeringsBySource.set(c.id, offerings.filter((o) => o.status !== "CANCELLED").length);
      }
      for (const c of toClassrooms) offeringsByTarget.set(c.id, (await classroomsRepo.listOfferings(tx, { classroomId: c.id })).length);
    }
    return ok({ from, to, fromPeriods, toPeriods, holidays, programs, fromVersions, toVersions, fromClassrooms, toClassrooms, liveRunId: live?.id ?? null, offeringsBySource, offeringsByTarget });
  });
  if (!base.ok) return base;
  const b = base.value;
  const fromRange = { startsOn: b.from.startsOn, endsOn: b.from.endsOn };
  const toRange = { startsOn: b.to.startsOn, endsOn: b.to.endsOn };

  // --- Périodes ---------------------------------------------------------------------------------------------------
  const periodCodes = new Map(b.toPeriods.map((p) => [p.id, p.code]));
  const periodsPlan = planPeriods(
    b.fromPeriods,
    fromRange,
    toRange,
    b.toPeriods.map((p) => ({ code: p.code, periodTypeCode: p.periodTypeCode, ordinal: p.ordinal, parentCode: p.parentPeriodId ? (periodCodes.get(p.parentPeriodId) ?? null) : null })),
  );
  if (steps.includes("PERIODS")) {
    if (b.fromPeriods.length === 0) warnings.push(warn("periods_source_missing", "PERIODS", "L'année source n'a aucune période à reconduire."));
    if (periodsPlan.existing > 0) warnings.push(warn("target_year_has_periods", "PERIODS", `${periodsPlan.existing} période(s) existent déjà dans l'année cible : elles sont conservées, seules les manquantes seront créées.`));
    if (periodsPlan.toCreate.some((p) => p.clamped) || periodsPlan.dropped.length > 0) {
      warnings.push(warn("periods_dates_clamped", "PERIODS", "Certaines périodes ont dû être raccourcies pour tenir dans l'année cible : vérifiez leurs dates."));
    }
  }

  // --- Jours fériés -----------------------------------------------------------------------------------------------
  const holidaysPlan = planHolidays(
    b.holidays.map((h) => ({ label: h.label, kind: h.kind, startsOn: h.startsOn, endsOn: h.endsOn, recursYearly: h.recursYearly, blocksTeaching: h.blocksTeaching })),
    fromRange,
    toRange,
    b.holidays,
  );
  if (steps.includes("HOLIDAYS") && holidaysPlan.notRecurring > 0) {
    warnings.push(warn("holidays_not_recurring", "HOLIDAYS", `${holidaysPlan.notRecurring} jour(s) de l'année source ne se répètent pas à date fixe (fêtes mobiles, fermetures) : à ressaisir pour l'année cible.`));
  }

  // --- Curriculum -------------------------------------------------------------------------------------------------
  const curriculumItems = b.programs.map((p: Program) => {
    const source = sourceVersionOf(b.fromVersions, p.id);
    const target = b.toVersions.find((v) => v.programId === p.id && v.status !== "ARCHIVED") ?? null;
    const reconductible = source !== null && (source.status === "PUBLISHED" || source.status === "LOCKED");
    const action: "CLONE" | "EXISTS" | "NO_SOURCE" = target ? "EXISTS" : reconductible ? "CLONE" : "NO_SOURCE";
    return {
      programId: p.id,
      programCode: p.code,
      programLabel: p.label,
      sourceVersionId: source?.id ?? null,
      sourceStatus: source?.status ?? null,
      nodeCount: source?.nodeCount ?? 0,
      targetVersionId: target?.id ?? null,
      action,
    };
  });
  if (steps.includes("CURRICULUM")) {
    for (const item of curriculumItems) {
      if (item.action === "NO_SOURCE") {
        warnings.push(
          item.sourceVersionId && item.sourceStatus === "DRAFT"
            ? warn("curriculum_source_draft", "CURRICULUM", `Le curriculum du programme « ${item.programLabel} » est encore en brouillon dans l'année source : il n'est pas reconduit (publiez-le d'abord).`)
            : warn("curriculum_source_missing", "CURRICULUM", `Le programme « ${item.programLabel} » n'a pas de curriculum dans l'année source : rien à reconduire.`),
        );
      } else if (item.action === "EXISTS") {
        warnings.push(warn("target_year_has_curriculum", "CURRICULUM", `Le programme « ${item.programLabel} » a déjà un curriculum dans l'année cible : il est conservé tel quel.`));
      }
    }
  }

  // --- Classes ----------------------------------------------------------------------------------------------------
  const classroomsPlan = planClassrooms(b.fromClassrooms.map(toSourceClassroom), fromRange, toRange, b.toClassrooms, null);
  if (steps.includes("CLASSROOMS")) {
    if (b.fromClassrooms.length === 0) warnings.push(warn("classrooms_source_missing", "CLASSROOMS", "L'année source n'a aucune classe à reconduire."));
    if (classroomsPlan.existing > 0) warnings.push(warn("target_year_has_classrooms", "CLASSROOMS", `${classroomsPlan.existing} classe(s) portent déjà le même code ou le même nom dans l'année cible : elles sont conservées.`));
  }

  // --- Offres -----------------------------------------------------------------------------------------------------
  let offeringsToCreate = 0;
  let offeringsExisting = 0;
  if (steps.includes("OFFERINGS")) {
    const targetByCode = new Map(b.toClassrooms.map((c) => [classroomCodeKey(c), c]));
    for (const c of b.fromClassrooms) {
      const count = b.offeringsBySource.get(c.id) ?? 0;
      if (count === 0) continue;
      const target = targetByCode.get(classroomCodeKey(c));
      if (target) {
        const n = b.offeringsByTarget.get(target.id) ?? 0;
        offeringsExisting += Math.min(n, count);
        offeringsToCreate += Math.max(0, count - n);
      } else if (steps.includes("CLASSROOMS") && classroomsPlan.toCreate.some((p) => p.sourceClassroomId === c.id)) {
        offeringsToCreate += count;
      }
    }
    if (offeringsToCreate > 0 && !steps.includes("CURRICULUM") && !steps.includes("CLASSROOMS")) {
      warnings.push(warn("offerings_need_curriculum", "OFFERINGS", "Les offres se rattachent au curriculum des classes de l'année cible : reconduisez aussi le curriculum et les classes, ou vérifiez qu'ils existent."));
    }
  }

  // --- Réinscriptions ---------------------------------------------------------------------------------------------
  let enrollments: AcademicRolloverPlanDto["enrollments"] = null;
  if (steps.includes("ENROLLMENTS")) {
    const planned = steps.includes("CLASSROOMS")
      ? classroomsPlan.toCreate.map((c) => ({ id: `planned:${c.sourceClassroomId}`, programId: c.programId, gradeLevelId: c.gradeLevelId, name: c.name, capacity: c.capacity, capacityIsHard: c.capacityIsHard, enrolledCount: 0 }))
      : [];
    const preview = await previewRollover(deps, ctx, fromYearId, { toAcademicYearId: query.toAcademicYearId, createMissingClassrooms: query.createMissingClassrooms ?? true }, planned);
    if (!preview.ok) return preview;
    enrollments = preview.value;
    const missing = preview.value.anomalies.filter((a) => a.code === "outcome_missing").length;
    if (missing > 0) {
      warnings.push(warn("promotion_decisions_missing", "ENROLLMENTS", `${missing} inscription(s) n'ont ni issue enregistrée ni décision de passage confirmée dans les résultats : elles ne seront pas réinscrites.`));
    }
  }

  return ok({
    fromAcademicYearId: b.from.id,
    toAcademicYearId: b.to.id,
    steps,
    liveRunId: b.liveRunId,
    warnings,
    periods: {
      toCreate: steps.includes("PERIODS") ? periodsPlan.toCreate.map(({ clamped: _clamped, ...p }) => p) : [],
      existing: periodsPlan.existing,
    },
    holidays: {
      toCreate: steps.includes("HOLIDAYS") ? holidaysPlan.toCreate.map((h) => ({ label: h.label, kind: h.kind, startsOn: h.startsOn, endsOn: h.endsOn })) : [],
      existing: holidaysPlan.existing,
      notRecurring: holidaysPlan.notRecurring,
    },
    curriculum: { items: steps.includes("CURRICULUM") ? curriculumItems : [] },
    classrooms: {
      toCreate: steps.includes("CLASSROOMS") ? classroomsPlan.toCreate.map((c) => ({ sourceClassroomId: c.sourceClassroomId, code: c.code, name: c.name, programId: c.programId, gradeLevelId: c.gradeLevelId, capacity: c.capacity })) : [],
      existing: classroomsPlan.existing,
    },
    offerings: { toCreate: offeringsToCreate, existing: offeringsExisting },
    enrollments,
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Demande d'exécution (HTTP) : enregistre et publie ; le worker exécute
// ---------------------------------------------------------------------------------------------------------------------

export function runToDto(run: repo.RolloverRun): AcademicRolloverRunDto {
  return {
    id: run.id,
    institutionId: run.institutionId,
    fromAcademicYearId: run.fromAcademicYearId,
    toAcademicYearId: run.toAcademicYearId,
    status: run.status,
    steps: run.options.steps,
    requestedBy: run.requestedBy,
    requestedAt: run.requestedAt,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    attempts: run.attempts,
    progress: run.progress,
    report: run.report,
    errorMessage: run.errorMessage,
  };
}

const initialProgress = (steps: readonly AcademicRolloverStep[]): repo.RolloverProgress => ({
  stage: null,
  steps: steps.map((key) => ({ key, status: "PENDING", done: 0, total: 0, message: null })),
});

function requestedPayload(run: repo.RolloverRun): { v: 1 } & Record<string, unknown> {
  return { v: 1, runId: run.id, institutionId: run.institutionId, fromAcademicYearId: run.fromAcademicYearId, toAcademicYearId: run.toAcademicYearId };
}

/**
 * Enregistre une exécution `PENDING` et publie `academic.rollover.requested` (même transaction). Une exécution déjà en attente
 * ou en cours pour le même couple d'années est RENVOYÉE (`created: false`), jamais doublée.
 */
export async function startRolloverRun(
  deps: AcademicDeps,
  ctx: RequestContext,
  fromYearId: string,
  body: AcademicRolloverRunBody,
  options: RolloverAssistOptions = {},
): Promise<Result<{ run: AcademicRolloverRunDto; created: boolean }, AppError>> {
  const { steps } = normalizeSteps(body.steps, options.offeringsEnabled ?? true);
  if (steps.length === 0) return err(validation(AcademicCode.ROLLOVER_INVALID, "Aucune étape à exécuter.", "steps"));
  return inTx<{ run: AcademicRolloverRunDto; created: boolean }>(deps, ctx, async (tx) => {
    const years = await loadYearPair(tx, ctx, fromYearId, body.toAcademicYearId);
    if (!years.ok) return years;
    const { from, to } = years.value;
    const live = await repo.findLiveRun(tx, from.id, to.id);
    if (live) return ok({ run: runToDto(live), created: false });
    const run = await repo.insertRun(tx, {
      id: deps.newId(),
      institutionId: from.institutionId,
      fromYearId: from.id,
      toYearId: to.id,
      options: { steps, classroomIds: body.classroomIds && body.classroomIds.length > 0 ? [...body.classroomIds] : null, createMissingClassrooms: body.createMissingClassrooms ?? true },
      requestedBy: ctx.userId,
      progress: initialProgress(steps),
    });
    const events = new EventBuffer(deps, ctx);
    events.add(AcademicEvents.ROLLOVER_REQUESTED, requestedPayload(run), { type: "rollover_run", id: run.id });
    events.audit({
      action: "academic.year.rollover_requested",
      resourceType: "academic_year",
      resourceId: to.id,
      sensitive: true,
      after: { runId: run.id, fromAcademicYearId: from.id, steps },
    });
    await events.flush(tx);
    return ok({ run: runToDto(run), created: true });
  });
}

/** Relance une exécution EN ÉCHEC : repasse `PENDING` et republie la demande (les étapes déjà faites sont des no-op). */
export async function retryRolloverRun(deps: AcademicDeps, ctx: RequestContext, runId: string): Promise<Result<AcademicRolloverRunDto, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const run = await repo.getRun(tx, runId, { forUpdate: true });
    if (!run) return err(notFound(AcademicCode.ROLLOVER_RUN_NOT_FOUND, "Reconduction", runId));
    if (run.status !== "FAILED") return err(conflict(AcademicCode.ROLLOVER_RUN_NOT_RETRYABLE, "Seule une reconduction en échec peut être relancée."));
    const live = await repo.findLiveRun(tx, run.fromAcademicYearId, run.toAcademicYearId);
    if (live) return err(conflict(AcademicCode.ROLLOVER_RUN_LIVE, "Une reconduction est déjà en attente ou en cours pour ces deux années."));
    const fresh = await repo.requeueRun(tx, run.id);
    const events = new EventBuffer(deps, ctx);
    events.add(AcademicEvents.ROLLOVER_REQUESTED, requestedPayload(fresh), { type: "rollover_run", id: fresh.id });
    await events.flush(tx);
    return ok(runToDto(fresh));
  });
}

export async function getRolloverRun(deps: AcademicDeps, ctx: RequestContext, runId: string): Promise<Result<AcademicRolloverRunDto, AppError>> {
  return inReadTx(deps, ctx, async (tx) => {
    const run = await repo.getRun(tx, runId);
    if (!run) return err(notFound(AcademicCode.ROLLOVER_RUN_NOT_FOUND, "Reconduction", runId));
    const year = await cal.getYear(tx, run.fromAcademicYearId);
    if (!year || (ctx.institutionId && year.institutionId !== ctx.institutionId)) return err(notFound(AcademicCode.ROLLOVER_RUN_NOT_FOUND, "Reconduction", runId));
    return ok(runToDto(run));
  });
}

export async function listRolloverRuns(deps: AcademicDeps, ctx: RequestContext, fromYearId: string, limit = 20): Promise<Result<AcademicRolloverRunDto[], AppError>> {
  return inReadTx(deps, ctx, async (tx) => {
    const year = await loadYear(tx, ctx, fromYearId);
    if (!year.ok) return year;
    return ok((await repo.listRuns(tx, fromYearId, Math.min(Math.max(limit, 1), 100))).map(runToDto));
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Exécution (worker)
// ---------------------------------------------------------------------------------------------------------------------

class Tracker {
  constructor(
    private readonly deps: AcademicDeps,
    private readonly ctx: RequestContext,
    private readonly runId: string,
    readonly progress: repo.RolloverProgress,
  ) {}

  private step(key: AcademicRolloverStep): repo.RolloverStepProgress {
    return this.progress.steps.find((s) => s.key === key) as repo.RolloverStepProgress;
  }

  async patch(key: AcademicRolloverStep, patch: Partial<Omit<repo.RolloverStepProgress, "key">>): Promise<void> {
    Object.assign(this.step(key), patch);
    this.progress.stage = key;
    await this.deps.db.run(this.ctx, (tx) => repo.saveRunProgress(tx, this.runId, this.progress));
  }
}

interface StepOutcome {
  created: number;
  existing: number;
  skipped: number;
  warnings: AcademicRolloverWarning[];
}

const emptyOutcome = (): StepOutcome => ({ created: 0, existing: 0, skipped: 0, warnings: [] });
const failedItem = (step: AcademicRolloverStep, what: string, e: AppError): AcademicRolloverWarning => warn("item_failed", step, `${what} : ${e.message}`);

async function stepPeriods(deps: AcademicDeps, ctx: RequestContext, run: repo.RolloverRun, tracker: Tracker): Promise<StepOutcome> {
  const out = emptyOutcome();
  const read = await inReadTx(deps, ctx, async (tx) => {
    const years = await loadYearPair(tx, ctx, run.fromAcademicYearId, run.toAcademicYearId);
    if (!years.ok) return years;
    const [fromPeriods, toPeriods] = await Promise.all([cal.listPeriods(tx, years.value.from.id), cal.listPeriods(tx, years.value.to.id)]);
    return ok({ ...years.value, fromPeriods, toPeriods });
  });
  if (!read.ok) throw read.error;
  const { from, to, fromPeriods, toPeriods } = read.value;
  const codeById = new Map(toPeriods.map((p) => [p.id, p.code]));
  const plan = planPeriods(
    fromPeriods,
    { startsOn: from.startsOn, endsOn: from.endsOn },
    { startsOn: to.startsOn, endsOn: to.endsOn },
    toPeriods.map((p) => ({ code: p.code, periodTypeCode: p.periodTypeCode, ordinal: p.ordinal, parentCode: p.parentPeriodId ? (codeById.get(p.parentPeriodId) ?? null) : null })),
  );
  out.existing = plan.existing;
  const idByCode = new Map(toPeriods.map((p) => [p.code, p.id]));
  await tracker.patch("PERIODS", { status: "RUNNING", total: plan.toCreate.length, done: 0 });
  let done = 0;
  for (const p of plan.toCreate) {
    const parentId = p.parentCode ? (idByCode.get(p.parentCode) ?? null) : null;
    if (p.parentCode && !parentId) {
      out.skipped += 1;
      out.warnings.push(warn("item_failed", "PERIODS", `Période « ${p.label} » : sa période parente n'a pas pu être créée.`));
      continue;
    }
    const r = await createPeriod(deps, ctx, to.id, { periodTypeCode: p.periodTypeCode, ordinal: p.ordinal, code: p.code, label: p.label, startsOn: p.startsOn, endsOn: p.endsOn, ...(parentId ? { parentPeriodId: parentId } : {}) });
    if (r.ok) {
      idByCode.set(p.code, r.value.id);
      out.created += 1;
    } else {
      out.skipped += 1;
      out.warnings.push(failedItem("PERIODS", `Période « ${p.label} »`, r.error));
    }
    done += 1;
    if (done % 10 === 0) await tracker.patch("PERIODS", { done });
  }
  if (plan.dropped.length > 0) out.warnings.push(warn("periods_dates_clamped", "PERIODS", `${plan.dropped.length} période(s) ne tiennent pas dans l'année cible et ont été ignorées.`));
  if (plan.toCreate.some((p) => p.clamped)) out.warnings.push(warn("periods_dates_clamped", "PERIODS", "Certaines périodes ont été raccourcies pour tenir dans l'année cible : vérifiez leurs dates."));
  return out;
}

async function stepHolidays(deps: AcademicDeps, ctx: RequestContext, run: repo.RolloverRun, tracker: Tracker): Promise<StepOutcome> {
  const out = emptyOutcome();
  const read = await inReadTx(deps, ctx, async (tx) => {
    const years = await loadYearPair(tx, ctx, run.fromAcademicYearId, run.toAcademicYearId);
    if (!years.ok) return years;
    return ok({ ...years.value, holidays: await repo.listHolidays(tx, { institutionId: years.value.from.institutionId }) });
  });
  if (!read.ok) throw read.error;
  const { from, to, holidays } = read.value;
  const plan = planHolidays(
    holidays,
    { startsOn: from.startsOn, endsOn: from.endsOn },
    { startsOn: to.startsOn, endsOn: to.endsOn },
    holidays,
  );
  out.existing = plan.existing;
  await tracker.patch("HOLIDAYS", { status: "RUNNING", total: plan.toCreate.length, done: 0 });
  if (plan.toCreate.length > 0) {
    const created = await inTx(deps, ctx, async (tx) => {
      for (const h of plan.toCreate) await repo.insertHoliday(tx, { id: deps.newId(), institutionId: from.institutionId, ...h });
      return ok(plan.toCreate.length);
    });
    if (!created.ok) throw created.error;
    out.created = created.value;
  }
  if (plan.notRecurring > 0) out.warnings.push(warn("holidays_not_recurring", "HOLIDAYS", `${plan.notRecurring} jour(s) ne se répètent pas à date fixe : à ressaisir pour l'année cible.`));
  return out;
}

async function stepCurriculum(deps: AcademicDeps, ctx: RequestContext, run: repo.RolloverRun, tracker: Tracker): Promise<StepOutcome> {
  const out = emptyOutcome();
  const read = await inReadTx(deps, ctx, async (tx) => {
    const years = await loadYearPair(tx, ctx, run.fromAcademicYearId, run.toAcademicYearId);
    if (!years.ok) return years;
    const institutionId = years.value.from.institutionId;
    const [programs, fromVersions, toVersions] = await Promise.all([
      cur.listPrograms(tx, { institutionId, status: "ACTIVE" }),
      cur.listVersions(tx, { yearId: years.value.from.id, institutionId }),
      cur.listVersions(tx, { yearId: years.value.to.id, institutionId }),
    ]);
    return ok({ ...years.value, programs, fromVersions, toVersions });
  });
  if (!read.ok) throw read.error;
  const { to, from, programs, fromVersions, toVersions } = read.value;
  await tracker.patch("CURRICULUM", { status: "RUNNING", total: programs.length, done: 0 });
  let done = 0;
  for (const p of programs) {
    done += 1;
    if (toVersions.some((v) => v.programId === p.id && v.status !== "ARCHIVED")) {
      out.existing += 1;
      continue;
    }
    const source = sourceVersionOf(fromVersions, p.id);
    if (!source) {
      out.skipped += 1;
      out.warnings.push(warn("curriculum_source_missing", "CURRICULUM", `Le programme « ${p.label} » n'a pas de curriculum dans l'année source.`));
      continue;
    }
    if (source.status !== "PUBLISHED" && source.status !== "LOCKED") {
      out.skipped += 1;
      out.warnings.push(warn("curriculum_source_draft", "CURRICULUM", `Le curriculum de « ${p.label} » est en brouillon dans l'année source : non reconduit.`));
      continue;
    }
    const r = await cloneCurriculumVersion(deps, ctx, { sourceVersionId: source.id, targetAcademicYearId: to.id, note: `Reconduction depuis l'année ${from.code}` });
    if (r.ok) out.created += 1;
    else {
      out.skipped += 1;
      out.warnings.push(failedItem("CURRICULUM", `Programme « ${p.label} »`, r.error));
    }
    await tracker.patch("CURRICULUM", { done });
  }
  return out;
}

async function stepClassrooms(deps: AcademicDeps, ctx: RequestContext, run: repo.RolloverRun, tracker: Tracker): Promise<StepOutcome> {
  const out = emptyOutcome();
  const read = await inReadTx(deps, ctx, async (tx) => {
    const years = await loadYearPair(tx, ctx, run.fromAcademicYearId, run.toAcademicYearId);
    if (!years.ok) return years;
    const institutionId = years.value.from.institutionId;
    const [fromClassrooms, toClassrooms, toVersions] = await Promise.all([
      allClassrooms(tx, institutionId, years.value.from.id),
      allClassrooms(tx, institutionId, years.value.to.id),
      cur.listVersions(tx, { yearId: years.value.to.id, institutionId }),
    ]);
    return ok({ ...years.value, fromClassrooms, toClassrooms, toVersions });
  });
  if (!read.ok) throw read.error;
  const { from, to, fromClassrooms, toClassrooms, toVersions } = read.value;
  const only = run.options.classroomIds ? new Set(run.options.classroomIds) : null;
  const plan = planClassrooms(fromClassrooms.map(toSourceClassroom), { startsOn: from.startsOn, endsOn: from.endsOn }, { startsOn: to.startsOn, endsOn: to.endsOn }, toClassrooms, only);
  out.existing = plan.existing;
  await tracker.patch("CLASSROOMS", { status: "RUNNING", total: plan.toCreate.length, done: 0 });
  let done = 0;
  for (const c of plan.toCreate) {
    const version = toVersions.find((v) => v.programId === c.programId && v.status !== "ARCHIVED") ?? null;
    const r = await createClassroom(deps, ctx, {
      institutionId: from.institutionId,
      academicYearId: to.id,
      programId: c.programId,
      gradeLevelId: c.gradeLevelId,
      kind: c.kind,
      code: c.code,
      name: c.name,
      ...(c.capacity !== null ? { capacity: c.capacity } : {}),
      capacityIsHard: c.capacityIsHard,
      ...(c.campusId ? { campusId: c.campusId } : {}),
      ...(c.startsOn ? { startsOn: c.startsOn } : {}),
      ...(c.endsOn ? { endsOn: c.endsOn } : {}),
      ...(version ? { curriculumVersionId: version.id } : {}),
    } as Parameters<typeof createClassroom>[2]);
    if (r.ok) out.created += 1;
    else {
      out.skipped += 1;
      out.warnings.push(failedItem("CLASSROOMS", `Classe « ${c.name} »`, r.error));
    }
    done += 1;
    if (done % 5 === 0) await tracker.patch("CLASSROOMS", { done });
  }
  return out;
}

async function stepOfferings(deps: AcademicDeps, ctx: RequestContext, run: repo.RolloverRun, tracker: Tracker): Promise<StepOutcome> {
  const out = emptyOutcome();
  const read = await inReadTx(deps, ctx, async (tx) => {
    const years = await loadYearPair(tx, ctx, run.fromAcademicYearId, run.toAcademicYearId);
    if (!years.ok) return years;
    const institutionId = years.value.from.institutionId;
    const [fromClassrooms, toClassrooms] = await Promise.all([allClassrooms(tx, institutionId, years.value.from.id), allClassrooms(tx, institutionId, years.value.to.id)]);
    return ok({ ...years.value, fromClassrooms, toClassrooms });
  });
  if (!read.ok) throw read.error;
  const { from, to, fromClassrooms, toClassrooms } = read.value;
  const only = run.options.classroomIds ? new Set(run.options.classroomIds) : null;
  const targetByCode = new Map(toClassrooms.map((c) => [classroomCodeKey(c), c]));
  const nodesByVersion = new Map<string, Map<string, CurriculumNode>>();
  const lineageNodes = async (versionId: string): Promise<Map<string, CurriculumNode>> => {
    let m = nodesByVersion.get(versionId);
    if (!m) {
      const nodes = await inReadTx(deps, ctx, async (tx) => ok(await cur.listNodes(tx, versionId)));
      m = new Map((nodes.ok ? nodes.value : []).map((n) => [n.lineageId, n]));
      nodesByVersion.set(versionId, m);
    }
    return m;
  };

  const work: Array<{ source: Classroom; target: Classroom }> = [];
  for (const c of fromClassrooms) {
    if (only && !only.has(c.id)) continue;
    const target = targetByCode.get(classroomCodeKey(c));
    if (target) work.push({ source: c, target });
  }
  await tracker.patch("OFFERINGS", { status: "RUNNING", total: work.length, done: 0 });
  let done = 0;
  for (const { source, target } of work) {
    done += 1;
    if (!target.curriculumVersionId || !source.curriculumVersionId) {
      out.warnings.push(warn("offerings_need_curriculum", "OFFERINGS", `La classe « ${target.name} » n'a pas de curriculum dans l'année cible : ses offres ne sont pas reconduites.`));
      continue;
    }
    const data = await inReadTx(deps, ctx, async (tx) => {
      const offerings = (await classroomsRepo.listOfferings(tx, { classroomId: source.id })).filter((o) => o.status !== "CANCELLED");
      const existing = await classroomsRepo.listOfferings(tx, { classroomId: target.id });
      const sourceNodes = new Map<string, CurriculumNode>();
      for (const o of offerings) {
        const n = await cur.getNode(tx, o.curriculumNodeId);
        if (n) sourceNodes.set(o.id, n);
      }
      return ok({ offerings, existing, sourceNodes });
    });
    if (!data.ok) throw data.error;
    const targetNodes = await lineageNodes(target.curriculumVersionId);
    const existingNodeIds = new Set(data.value.existing.map((o) => o.curriculumNodeId));
    for (const o of data.value.offerings) {
      const sourceNode = data.value.sourceNodes.get(o.id);
      const targetNode = sourceNode ? targetNodes.get(sourceNode.lineageId) : undefined;
      if (!targetNode) {
        out.skipped += 1;
        out.warnings.push(warn("item_failed", "OFFERINGS", `Offre « ${o.label} » : le nœud de curriculum n'existe pas dans la version de l'année cible.`));
        continue;
      }
      if (existingNodeIds.has(targetNode.id)) {
        out.existing += 1;
        continue;
      }
      const shifted = shiftOffering(
        { label: o.label, startsOn: o.startsOn, endsOn: o.endsOn, registrationOpensAt: o.registrationOpensAt, registrationClosesAt: o.registrationClosesAt, capacity: o.capacity },
        { startsOn: from.startsOn, endsOn: from.endsOn },
        { startsOn: to.startsOn, endsOn: to.endsOn },
      );
      if (!shifted) {
        out.skipped += 1;
        out.warnings.push(warn("periods_dates_clamped", "OFFERINGS", `Offre « ${o.label} » : ses dates ne tiennent pas dans l'année cible.`));
        continue;
      }
      const r = await createOffering(deps, ctx, target.id, {
        curriculumNodeId: targetNode.id,
        label: shifted.label,
        startsOn: shifted.startsOn,
        endsOn: shifted.endsOn,
        ...(shifted.registrationOpensAt && shifted.registrationClosesAt ? { registrationOpensAt: shifted.registrationOpensAt, registrationClosesAt: shifted.registrationClosesAt } : {}),
        ...(shifted.capacity !== null ? { capacity: shifted.capacity } : {}),
      } as Parameters<typeof createOffering>[3]);
      if (r.ok) out.created += 1;
      else {
        out.skipped += 1;
        out.warnings.push(failedItem("OFFERINGS", `Offre « ${o.label} »`, r.error));
      }
    }
    await tracker.patch("OFFERINGS", { done });
  }
  return out;
}

/**
 * Exécute une demande de reconduction (appelée par l'abonné du worker, ou directement par un script / un test). IDEMPOTENTE :
 * une exécution terminée est renvoyée telle quelle ; une exécution en cours depuis peu n'est pas doublée ; une exécution en
 * échec ou interrompue reprend (les étapes déjà faites ne recréent rien).
 */
export async function executeRolloverRun(deps: AcademicDeps, ctx: RequestContext, runId: string): Promise<Result<AcademicRolloverRunDto, AppError>> {
  const claimed = await inTx<{ run: repo.RolloverRun; skip: boolean }>(deps, ctx, async (tx) => {
    const run = await repo.getRun(tx, runId, { forUpdate: true });
    if (!run) return err(notFound(AcademicCode.ROLLOVER_RUN_NOT_FOUND, "Reconduction", runId));
    if (run.status === "COMPLETED") return ok({ run, skip: true });
    if (run.status === "RUNNING" && deps.clock.now().getTime() - new Date(run.updatedAt).getTime() < ROLLOVER_STALE_AFTER_MS) return ok({ run, skip: true });
    return ok({ run: await repo.markRunStarted(tx, run.id), skip: false });
  });
  if (!claimed.ok) return claimed;
  if (claimed.value.skip) return ok(runToDto(claimed.value.run));
  const run = claimed.value.run;
  const progress: repo.RolloverProgress = { stage: null, steps: run.options.steps.map((key) => ({ key, status: "PENDING", done: 0, total: 0, message: null })) };
  const tracker = new Tracker(deps, ctx, run.id, progress);

  const report: AcademicRolloverRunReport = {
    periodsCreated: 0,
    holidaysCreated: 0,
    curriculumVersionsCreated: 0,
    classroomsCreated: 0,
    offeringsCreated: 0,
    enrollmentsCreated: 0,
    alreadyRolledOver: 0,
    skipped: 0,
    warnings: [],
    anomalies: [],
  };
  const settle = async (key: AcademicRolloverStep, o: StepOutcome): Promise<void> => {
    report.skipped += o.skipped;
    report.warnings.push(...o.warnings);
    await tracker.patch(key, { status: "DONE", done: o.created + o.existing + o.skipped, total: o.created + o.existing + o.skipped, message: `${o.created} créé(s), ${o.existing} déjà présent(s), ${o.skipped} ignoré(s)` });
  };

  let current: AcademicRolloverStep | null = null;
  try {
    for (const step of run.options.steps) {
      current = step;
      await tracker.patch(step, { status: "RUNNING" });
      if (step === "PERIODS") {
        const o = await stepPeriods(deps, ctx, run, tracker);
        report.periodsCreated = o.created;
        await settle(step, o);
      } else if (step === "HOLIDAYS") {
        const o = await stepHolidays(deps, ctx, run, tracker);
        report.holidaysCreated = o.created;
        await settle(step, o);
      } else if (step === "CURRICULUM") {
        const o = await stepCurriculum(deps, ctx, run, tracker);
        report.curriculumVersionsCreated = o.created;
        await settle(step, o);
      } else if (step === "CLASSROOMS") {
        const o = await stepClassrooms(deps, ctx, run, tracker);
        report.classroomsCreated = o.created;
        await settle(step, o);
      } else if (step === "OFFERINGS") {
        const o = await stepOfferings(deps, ctx, run, tracker);
        report.offeringsCreated = o.created;
        await settle(step, o);
      } else {
        const r = await rolloverAcademicYear(
          deps,
          ctx,
          run.fromAcademicYearId,
          { toAcademicYearId: run.toAcademicYearId, ...(run.options.classroomIds ? { classroomIds: run.options.classroomIds } : {}), createMissingClassrooms: run.options.createMissingClassrooms },
          { finalize: false, onProgress: (done, total) => tracker.patch("ENROLLMENTS", { done, total }) },
        );
        if (!r.ok) throw r.error;
        report.enrollmentsCreated = r.value.enrollmentsCreated;
        report.alreadyRolledOver = r.value.alreadyRolledOver;
        report.classroomsCreated += r.value.classroomsCreated;
        report.skipped += r.value.skipped;
        report.anomalies.push(...(r.value.anomalies as RolloverAnomaly[]));
        const missing = r.value.anomalies.filter((a) => a.code === "outcome_missing").length;
        if (missing > 0) report.warnings.push(warn("promotion_decisions_missing", "ENROLLMENTS", `${missing} inscription(s) sans issue ni décision de passage confirmée : non réinscrites.`));
        await tracker.patch("ENROLLMENTS", { status: "DONE", message: `${r.value.enrollmentsCreated} réinscription(s), ${r.value.alreadyRolledOver} déjà faite(s), ${r.value.skipped} ignorée(s)` });
      }
    }
  } catch (e) {
    const message = (e instanceof Error ? e.message : String(e)).slice(0, 500);
    if (current) {
      const step = tracker.progress.steps.find((s) => s.key === current);
      if (step) Object.assign(step, { status: "FAILED", message });
    }
    await deps.db.run(ctx, (tx) => repo.finishRun(tx, run.id, { status: "FAILED", progress: tracker.progress, report: null, errorMessage: message }));
    deps.logger.error({ runId: run.id, step: current, err: message }, "academic : reconduction en échec");
    throw e;
  }

  const finished = await inTx<repo.RolloverRun>(deps, ctx, async (tx) => {
    tracker.progress.stage = null;
    const done = await repo.finishRun(tx, run.id, { status: "COMPLETED", progress: tracker.progress, report, errorMessage: null });
    const events = new EventBuffer(deps, ctx);
    events.add(
      AcademicEvents.ROLLOVER_COMPLETED,
      {
        v: 1,
        institutionId: run.institutionId,
        fromAcademicYearId: run.fromAcademicYearId,
        toAcademicYearId: run.toAcademicYearId,
        enrollmentsCreated: report.enrollmentsCreated,
        classroomsCreated: report.classroomsCreated,
        runId: run.id,
      },
      { type: "academic_year", id: run.toAcademicYearId },
    );
    events.audit({
      action: "academic.year.rollover",
      resourceType: "academic_year",
      resourceId: run.toAcademicYearId,
      sensitive: true,
      after: { runId: run.id, fromAcademicYearId: run.fromAcademicYearId, ...Object.fromEntries(Object.entries(report).filter(([, v]) => typeof v === "number")) },
    });
    await events.flush(tx);
    return ok(done);
  });
  if (!finished.ok) return finished;
  return ok(runToDto(finished.value));
}
