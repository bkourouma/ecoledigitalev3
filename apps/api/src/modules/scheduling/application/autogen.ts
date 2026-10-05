/**
 * Générateur d'emploi du temps (spec 017, question O-05) — cas d'usage.
 *
 *   startAutogenRun      demande de génération : validée tout de suite, calculée dans la requête si elle est petite
 *                        (≤ `AUTOGEN_DEFAULTS.syncSessionLimit` séances), sinon mise en file (QUEUED) et calculée
 *                        par le job `scheduling.process-autogen-runs` du worker ;
 *   executeAutogenRun    QUEUED → RUNNING → COMPLETED | FAILED ; le calcul se fait HORS transaction (la connexion
 *                        n'est pas retenue pendant la recherche) ;
 *   applyAutogenRun      acte HUMAIN : crée un NOUVEAU brouillon (ou remplace, après confirmation, un brouillon) ;
 *                        n'écrit JAMAIS dans un emploi du temps publié et ne publie rien ;
 *   discardAutogenRun    abandonne une proposition.
 *
 * La proposition est un instantané figé (la base interdit de la modifier) : ce que l'humain a examiné est ce qui
 * est appliqué. Avant d'écrire, l'application revérifie classes, matières, enseignants et salles et contrôle
 * qu'aucun conflit entre patrons n'est introduit.
 */
import { ConflictError, ValidationError, err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import { classifyEntryConflictsFor } from "./entry-conflicts";
import { detectEntryConflicts, hasBlocking } from "../domain/conflicts";
import { generateTimetable } from "../domain/autogen/engine";
import { verifyHard } from "../domain/autogen/verify";
import { DEFAULT_WEIGHTS, type GenResult } from "../domain/autogen/types";
import { SchedulingCodes, academicUnavailable, notFound } from "../domain/errors";
import { SchedulingEvents } from "../domain/events";
import { formatTimeOfDay } from "../domain/time";
import type { Timetable } from "../domain/types";
import * as repo from "../infrastructure/autogen-repo";
import * as ref from "../infrastructure/reference-repo";
import * as tt from "../infrastructure/timetable-repo";
import { AUTOGEN_DEFAULTS, prepareProblem, resolveGrid, resolveWeekdays, type AutogenParams, type PreparedProblem } from "./autogen-input";
import { EventBuffer, inTx, type SchedulingDeps } from "./deps";
import { checkTimetableDates } from "./timetables";
import { checkStaffEligible, loadSettings, validation } from "./support";

const RUN_AGGREGATE = "autogen_run";
/** Un run « RUNNING » depuis plus longtemps que cela est considéré comme interrompu. */
export const AUTOGEN_STALE_MINUTES = 20;

// ---------------------------------------------------------------------------
// Forme de la proposition enregistrée (voir `schedulingAutogenResultDtoSchema`)
// ---------------------------------------------------------------------------

export interface AutogenResultJson {
  grid: PreparedProblem["grid"];
  placements: Array<{
    requirementId: string;
    sessionIndex: number;
    classroomId: string;
    curriculumNodeId: string;
    teacherId: string | null;
    roomId: string | null;
    timeSlotId: string | null;
    weekday: number;
    startPeriod: number;
    periods: number;
    startTime: string;
    endTime: string;
  }>;
  unplaced: GenResult["unplaced"] extends readonly (infer U)[] ? Array<Omit<U, "reasons"> & { reasons: Array<{ code: string; count: number; detail?: string }> }> : never;
  score: { softCost: number; initialSoftCost: number; unplacedSessions: number; breakdown: GenResult["breakdown"] };
  stats: { sessions: number; placed: number; iterations: number; accepted: number; improvements: number; stoppedBy: string; elapsedMs: number; seed: string };
  warnings: Array<{ code: string; message: string; requirementId?: string }>;
  labels: PreparedProblem["labels"];
  publishedTimetable: { id: string; name: string } | null;
}

function buildResult(prepared: PreparedProblem, gen: GenResult, seed: string): AutogenResultJson {
  return {
    grid: prepared.grid,
    placements: gen.placements.map((p) => ({
      requirementId: p.requirementId,
      sessionIndex: p.sessionIndex,
      classroomId: p.classroomId,
      curriculumNodeId: p.curriculumNodeId,
      teacherId: p.teacherId,
      roomId: p.roomId,
      timeSlotId: p.timeSlotId,
      weekday: p.weekday,
      startPeriod: p.startPeriod,
      periods: p.periods,
      startTime: formatTimeOfDay(p.startMinute),
      endTime: formatTimeOfDay(p.endMinute),
    })),
    unplaced: gen.unplaced.map((u) => ({ ...u, reasons: u.reasons.map((r) => ({ ...r })) })) as AutogenResultJson["unplaced"],
    score: { softCost: gen.softCost, initialSoftCost: gen.stats.initialSoftCost, unplacedSessions: gen.stats.unplacedSessions, breakdown: gen.breakdown },
    stats: {
      sessions: gen.stats.sessions,
      placed: gen.stats.placed,
      iterations: gen.stats.iterations,
      accepted: gen.stats.accepted,
      improvements: gen.stats.improvements,
      stoppedBy: gen.stats.stoppedBy,
      elapsedMs: Math.round(gen.stats.elapsedMs),
      seed,
    },
    warnings: [...prepared.warnings, ...gen.warnings.map((w) => ({ code: w.code, message: w.message, ...(w.requirementId ? { requirementId: w.requirementId } : {}) }))],
    labels: prepared.labels,
    publishedTimetable: prepared.publishedTimetable,
  };
}

// ---------------------------------------------------------------------------
// Valeurs par défaut pour l'écran de lancement
// ---------------------------------------------------------------------------

export interface AutogenDefaults {
  weekdays: number[];
  periods: Array<{ index: number; startTime: string; endTime: string; label: string | null }>;
  gridSource: "TIME_SLOTS" | "REGULAR" | "NONE";
  weights: typeof DEFAULT_WEIGHTS;
  timeLimitSeconds: { default: number; max: number };
  maxIterations: { default: number; max: number };
  syncSessionLimit: number;
  rooms: number;
  availabilityMode: "OPEN" | "CLOSED";
  ports: { academic: boolean; people: boolean };
}

export async function getAutogenDefaults(deps: SchedulingDeps, ctx: RequestContext, input: { institutionId: string; campusId?: string | undefined }): Promise<Result<AutogenDefaults, AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const settings = await loadSettings(tx, input.institutionId);
      const grid = await resolveGrid(tx, settings, { institutionId: input.institutionId, campusId: input.campusId ?? null });
      const weekdays = resolveWeekdays(settings, undefined);
      const rooms = await ref.listRooms(tx, { institutionId: input.institutionId, ...(input.campusId ? { campusId: input.campusId } : {}), status: "AVAILABLE" });
      return ok({
        weekdays: weekdays.ok ? weekdays.value : [],
        periods: grid.ok ? grid.value.periods.map((p, index) => ({ index, startTime: formatTimeOfDay(p.startMinute), endTime: formatTimeOfDay(p.endMinute), label: p.label ?? null })) : [],
        gridSource: grid.ok ? grid.value.source : ("NONE" as const),
        weights: DEFAULT_WEIGHTS,
        timeLimitSeconds: { default: AUTOGEN_DEFAULTS.timeLimitSeconds, max: AUTOGEN_DEFAULTS.maxTimeLimitSeconds },
        maxIterations: { default: AUTOGEN_DEFAULTS.maxIterations, max: AUTOGEN_DEFAULTS.maxIterationsCap },
        syncSessionLimit: AUTOGEN_DEFAULTS.syncSessionLimit,
        rooms: rooms.length,
        availabilityMode: settings.staffAvailabilityMode,
        ports: { academic: deps.ports.academic !== null, people: deps.ports.people !== null },
      });
    },
    { readOnly: true },
  );
}

// ---------------------------------------------------------------------------
// Demande
// ---------------------------------------------------------------------------

export interface StartResult {
  run: repo.AutogenRunRow;
  /** `true` si le calcul a été fait dans la requête. */
  executed: boolean;
}

export async function startAutogenRun(deps: SchedulingDeps, ctx: RequestContext, params: AutogenParams): Promise<Result<StartResult, AppError>> {
  const name = params.name.trim();
  if (name.length === 0) return err(validation("name", "Le nom est requis.", "required"));
  const seed = (params.seed ?? deps.newId()).trim();
  const normalized: AutogenParams = { ...params, name, seed, timeLimitSeconds: params.timeLimitSeconds ?? AUTOGEN_DEFAULTS.timeLimitSeconds, maxIterations: params.maxIterations ?? AUTOGEN_DEFAULTS.maxIterations };

  // 1. Validation immédiate (retour d'erreur clair avant toute mise en file).
  const dates = await checkTimetableDates(deps, ctx, { validFrom: params.validFrom, validTo: params.validTo, academicYearId: params.academicYearId, periodId: params.periodId ?? null });
  if (!dates.ok) return dates;
  const prepared = await inTx(deps, ctx, (tx) => prepareProblem(deps, ctx, tx, normalized, seed), { readOnly: true });
  if (!prepared.ok) return prepared;
  const sessions = prepared.value.sessionCount;

  // 2. Enregistrement.
  const created = await inTx(deps, ctx, async (tx) => {
    const row = await repo.insertRun(
      tx,
      ctx.tenantId,
      {
        id: deps.newId(),
        institutionId: params.institutionId,
        campusId: params.campusId ?? null,
        academicYearId: params.academicYearId,
        periodId: params.periodId ?? null,
        name,
        seed,
        params: normalized as unknown as Record<string, unknown>,
        summary: { sessions, requirements: params.requirements.length },
        fixedTimetableId: params.fixedTimetableId ?? null,
      },
      ctx.userId,
      deps.clock.now(),
    );
    const buf = new EventBuffer(deps, ctx);
    buf.audit({ action: "scheduling.autogen_run.requested", resourceType: RUN_AGGREGATE, resourceId: row.id, metadata: { sessions, requirements: params.requirements.length } });
    await buf.flush(tx);
    return ok(row);
  });
  if (!created.ok) return created;

  // 3. Calcul immédiat si la demande est petite (ou demandé), sinon le worker s'en charge.
  const mode = params.mode ?? "AUTO";
  // Le calcul dans la requête est borné : au-delà de `syncMaxSeconds` de limite de temps, il passe par le worker.
  const shortEnough = (normalized.timeLimitSeconds ?? AUTOGEN_DEFAULTS.timeLimitSeconds) <= AUTOGEN_DEFAULTS.syncMaxSeconds;
  const inline = (mode === "SYNC" || (mode === "AUTO" && sessions <= AUTOGEN_DEFAULTS.syncSessionLimit)) && shortEnough;
  if (!inline) return ok({ run: created.value, executed: false });
  const executed = await executeAutogenRun(deps, ctx, created.value.id);
  if (!executed.ok) return executed;
  const fresh = await inTx(deps, ctx, async (tx) => ok(await repo.getRun(tx, created.value.id)), { readOnly: true });
  if (!fresh.ok) return fresh;
  return ok({ run: fresh.value ?? created.value, executed: true });
}

// ---------------------------------------------------------------------------
// Exécution
// ---------------------------------------------------------------------------

async function failRun(deps: SchedulingDeps, ctx: RequestContext, runId: string, code: string, message: string): Promise<Result<repo.AutogenRunRow, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const row = await repo.markFailed(tx, runId, code, message, deps.clock.now());
    const buf = new EventBuffer(deps, ctx);
    buf.add(SchedulingEvents.autogenRunFailed, { v: 1, runId, institutionId: row.institutionId, code }, { type: RUN_AGGREGATE, id: runId });
    buf.audit({ action: "scheduling.autogen_run.failed", resourceType: RUN_AGGREGATE, resourceId: runId, metadata: { code } });
    await buf.flush(tx);
    return ok(row);
  });
}

/**
 * Calcule un run en attente. Renvoie `null` si le run n'est plus en attente (déjà pris par un autre worker).
 * Une erreur de calcul ou de données n'est PAS une erreur du cas d'usage : le run passe en FAILED avec son motif.
 */
export async function executeAutogenRun(deps: SchedulingDeps, ctx: RequestContext, runId: string): Promise<Result<repo.AutogenRunRow | null, AppError>> {
  const claimed = await inTx(deps, ctx, async (tx) => ok(await repo.claim(tx, runId, deps.clock.now())));
  if (!claimed.ok) return claimed;
  const run = claimed.value;
  if (!run) return ok(null);
  const params = run.params as unknown as AutogenParams;

  const prepared = await inTx(deps, ctx, (tx) => prepareProblem(deps, ctx, tx, params, run.seed), { readOnly: true });
  if (!prepared.ok) return failRun(deps, ctx, runId, prepared.error.code ?? SchedulingCodes.autogenFailed, prepared.error.message);

  let gen: GenResult;
  try {
    gen = generateTimetable(prepared.value.problem, { now: () => Date.now() });
  } catch (e) {
    deps.logger.error({ err: e, runId }, "scheduling : le générateur a échoué");
    return failRun(deps, ctx, runId, SchedulingCodes.autogenFailed, "Le calcul de l'emploi du temps a échoué.");
  }
  // Garde-fou : la proposition ne doit contenir aucune violation dure (vérificateur indépendant du moteur).
  const violations = verifyHard(prepared.value.problem, gen.placements);
  if (violations.length > 0) {
    deps.logger.error({ runId, violations: violations.slice(0, 5).map((v) => v.code) }, "scheduling : proposition invalide rejetée");
    return failRun(deps, ctx, runId, SchedulingCodes.autogenInvariant, `La proposition a été rejetée : ${violations.length} contrainte(s) dure(s) non respectée(s).`);
  }

  const result = buildResult(prepared.value, gen, run.seed);
  const summary = { sessions: gen.stats.sessions, placed: gen.stats.placed, unplacedSessions: gen.stats.unplacedSessions, softCost: gen.softCost, requirements: params.requirements.length };
  return inTx(deps, ctx, async (tx) => {
    const row = await repo.markCompleted(tx, runId, result as unknown as Record<string, unknown>, summary, deps.clock.now());
    const buf = new EventBuffer(deps, ctx);
    buf.add(
      SchedulingEvents.autogenRunCompleted,
      { v: 1, runId, institutionId: row.institutionId, sessions: summary.sessions, placed: summary.placed, unplacedSessions: summary.unplacedSessions },
      { type: RUN_AGGREGATE, id: runId },
    );
    buf.audit({ action: "scheduling.autogen_run.completed", resourceType: RUN_AGGREGATE, resourceId: runId, metadata: summary });
    await buf.flush(tx);
    return ok(row);
  });
}

export interface ProcessReport {
  processed: number;
  failed: number;
  interrupted: number;
}

/** Corps du job du worker : marque les runs interrompus, puis calcule les runs en attente (au plus `max`). */
export async function processQueuedAutogenRuns(deps: SchedulingDeps, ctx: RequestContext, options: { max?: number } = {}): Promise<Result<ProcessReport, AppError>> {
  const max = options.max ?? 3;
  const report: ProcessReport = { processed: 0, failed: 0, interrupted: 0 };
  const stale = await inTx(deps, ctx, async (tx) => ok(await repo.listStaleRunning(tx, new Date(deps.clock.now().getTime() - AUTOGEN_STALE_MINUTES * 60_000))), { readOnly: true });
  if (!stale.ok) return stale;
  for (const id of stale.value) {
    const r = await failRun(deps, ctx, id, SchedulingCodes.autogenInterrupted, "Le calcul a été interrompu avant la fin : relancez la génération.");
    if (r.ok) report.interrupted += 1;
  }
  const queued = await inTx(deps, ctx, async (tx) => ok(await repo.listQueuedIds(tx, max)), { readOnly: true });
  if (!queued.ok) return queued;
  for (const id of queued.value) {
    const r = await executeAutogenRun(deps, ctx, id);
    if (!r.ok) return r;
    if (r.value) {
      report.processed += 1;
      if (r.value.status === "FAILED") report.failed += 1;
    }
  }
  return ok(report);
}

// ---------------------------------------------------------------------------
// Lecture
// ---------------------------------------------------------------------------

export function listAutogenRuns(deps: SchedulingDeps, ctx: RequestContext, filter: { institutionId?: string | undefined; status?: repo.AutogenStatus | undefined; limit?: number | undefined }): Promise<Result<repo.AutogenRunRow[], AppError>> {
  return inTx(deps, ctx, async (tx) => ok(await repo.listRuns(tx, { ...(filter.institutionId ? { institutionId: filter.institutionId } : {}), ...(filter.status ? { status: filter.status } : {}), limit: filter.limit ?? 50 })), { readOnly: true });
}

export function getAutogenRun(deps: SchedulingDeps, ctx: RequestContext, input: { runId: string }): Promise<Result<{ run: repo.AutogenRunRow; result: AutogenResultJson | null }, AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const run = await repo.getRun(tx, input.runId, { withResult: true });
      if (!run) return err(notFound("Génération d'emploi du temps", input.runId));
      return ok({ run, result: (run.result as unknown as AutogenResultJson | null) ?? null });
    },
    { readOnly: true },
  );
}

// ---------------------------------------------------------------------------
// Abandon
// ---------------------------------------------------------------------------

export async function discardAutogenRun(deps: SchedulingDeps, ctx: RequestContext, input: { runId: string; reason?: string | undefined }): Promise<Result<repo.AutogenRunRow, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const run = await repo.getRun(tx, input.runId, { forUpdate: true });
    if (!run) return err(notFound("Génération d'emploi du temps", input.runId));
    if (run.status === "DISCARDED") return ok(run);
    if (!["QUEUED", "COMPLETED", "FAILED"].includes(run.status)) {
      return err(new ConflictError(run.status === "APPLIED" ? "Cette proposition a déjà été appliquée." : "Le calcul est en cours : attendez sa fin pour l'abandonner.", { code: SchedulingCodes.autogenNotApplicable, details: { status: run.status } }));
    }
    const row = await repo.markDiscarded(tx, run.id, ctx.userId, deps.clock.now());
    const buf = new EventBuffer(deps, ctx);
    buf.audit({ action: "scheduling.autogen_run.discarded", resourceType: RUN_AGGREGATE, resourceId: run.id, ...(input.reason ? { reason: input.reason } : {}) });
    await buf.flush(tx);
    return ok(row);
  });
}

// ---------------------------------------------------------------------------
// Application par un humain
// ---------------------------------------------------------------------------

export interface ApplyInput {
  runId: string;
  mode?: "NEW_DRAFT" | "REPLACE_DRAFT" | undefined;
  name?: string | undefined;
  validFrom?: string | undefined;
  validTo?: string | undefined;
  targetTimetableId?: string | undefined;
  confirmReplace?: boolean | undefined;
  acceptUnplaced?: boolean | undefined;
}

export interface ApplyResult {
  run: repo.AutogenRunRow;
  timetable: Timetable;
  entriesCreated: number;
  entriesReplaced: number;
  unplacedSessions: number;
  publishedTimetable: { id: string; name: string } | null;
}

const confirmation = (message: string, path: string): ValidationError =>
  new ValidationError(message, [{ path: [path], message, code: "confirmation_required" }], { code: SchedulingCodes.autogenConfirmationRequired });

export async function applyAutogenRun(deps: SchedulingDeps, ctx: RequestContext, input: ApplyInput): Promise<Result<ApplyResult, AppError>> {
  const academic = deps.ports.academic;
  if (!academic) return err(academicUnavailable());
  const mode = input.mode ?? "NEW_DRAFT";
  return inTx(deps, ctx, async (tx) => {
    const buf = new EventBuffer(deps, ctx);
    const run = await repo.getRun(tx, input.runId, { forUpdate: true, withResult: true });
    if (!run) return err(notFound("Génération d'emploi du temps", input.runId));
    if (run.status !== "COMPLETED" || !run.result) {
      const why = run.status === "APPLIED" ? "Cette proposition a déjà été appliquée." : run.status === "DISCARDED" ? "Cette proposition a été abandonnée." : "Seule une proposition calculée peut être appliquée.";
      return err(new ConflictError(why, { code: SchedulingCodes.autogenNotApplicable, details: { status: run.status } }));
    }
    const result = run.result as unknown as AutogenResultJson;
    const params = run.params as unknown as AutogenParams;
    if (result.score.unplacedSessions > 0 && !input.acceptUnplaced) {
      return err(confirmation(`La proposition laisse ${result.score.unplacedSessions} séance(s) non placée(s) : confirmez pour appliquer une proposition incomplète.`, "acceptUnplaced"));
    }
    if (result.placements.length === 0) return err(validation("placements", "La proposition ne contient aucune séance à appliquer.", "empty_proposal"));

    // Cible : nouveau brouillon, ou brouillon existant (jamais un emploi du temps publié).
    let timetable: Timetable;
    let replaced = 0;
    if (mode === "REPLACE_DRAFT") {
      if (!input.targetTimetableId) return err(validation("targetTimetableId", "Choisissez le brouillon à remplacer.", "required"));
      const target = await tt.getTimetable(tx, input.targetTimetableId, true);
      if (!target) return err(notFound("Emploi du temps", input.targetTimetableId));
      if (target.status === "PUBLISHED") {
        return err(
          new ConflictError("Cet emploi du temps est publié : la génération ne l'écrase jamais. Appliquez la proposition à un nouveau brouillon, puis publiez-le explicitement.", {
            code: SchedulingCodes.autogenWouldOverwritePublished,
            details: { timetableId: target.id },
          }),
        );
      }
      if (target.status !== "DRAFT") return err(new ConflictError("Seul un brouillon peut être remplacé.", { code: SchedulingCodes.autogenTargetNotDraft, details: { status: target.status } }));
      if (target.academicYearId !== run.academicYearId) return err(validation("targetTimetableId", "Le brouillon appartient à une autre année scolaire.", "year_mismatch"));
      if (!input.confirmReplace) return err(confirmation(`Le contenu du brouillon « ${target.name} » sera remplacé : confirmez pour continuer.`, "confirmReplace"));
      const existing = await tt.listEntries(tx, target.id, { includeEnded: true });
      for (const e of existing) {
        if (await tt.entryHasOccurrences(tx, e.id)) return err(new ConflictError("Ce brouillon a déjà produit des séances : il ne peut pas être remplacé.", { code: SchedulingCodes.timetableNotEditable }));
      }
      for (const e of existing) await tt.deleteEntry(tx, e.id);
      replaced = existing.length;
      timetable = target;
    } else {
      const validFrom = input.validFrom ?? params.validFrom;
      const validTo = input.validTo ?? params.validTo;
      const dates = await checkTimetableDates(deps, ctx, { validFrom, validTo, academicYearId: run.academicYearId, periodId: run.periodId });
      if (!dates.ok) return dates;
      timetable = await tt.insertTimetable(
        tx,
        ctx.tenantId,
        { id: deps.newId(), institutionId: run.institutionId, campusId: run.campusId, academicYearId: run.academicYearId, periodId: run.periodId, name: (input.name ?? run.name).trim(), validFrom, validTo, weekAAnchor: null, clonedFromId: null },
        ctx.userId,
        deps.clock.now(),
      );
    }

    // Revérification de l'état courant (les données ont pu changer depuis le calcul).
    for (const id of new Set(result.placements.map((p) => p.classroomId))) {
      const c = await academic.getClassroom(ctx, id);
      if (!c) return err(validation("classroomId", `La classe ${result.labels.classrooms[id] ?? id} n'existe plus : relancez la génération.`, "classroom_missing"));
    }
    for (const id of new Set(result.placements.map((p) => p.curriculumNodeId))) {
      if (!(await academic.getCurriculumNode(ctx, id))) return err(validation("curriculumNodeId", `La matière ${result.labels.nodes[id] ?? id} n'existe plus : relancez la génération.`, "node_missing"));
    }
    const staffIds = [...new Set(result.placements.flatMap((p) => (p.teacherId ? [p.teacherId] : [])))];
    const eligible = await checkStaffEligible(deps, ctx, staffIds);
    if (!eligible.ok) return eligible;
    const roomIds = [...new Set(result.placements.flatMap((p) => (p.roomId ? [p.roomId] : [])))];
    const rooms = new Map((await ref.getRoomsByIds(tx, roomIds)).map((r) => [r.id, r]));
    for (const id of roomIds) {
      const room = rooms.get(id);
      if (!room || room.status !== "AVAILABLE") return err(validation("roomId", `La salle ${result.labels.rooms[id] ?? id} n'est plus disponible : relancez la génération.`, "room_unavailable"));
    }

    const now = deps.clock.now();
    for (const p of result.placements) {
      const [sh, sm] = p.startTime.split(":").map(Number) as [number, number];
      const [eh, em] = p.endTime.split(":").map(Number) as [number, number];
      await tt.insertEntry(
        tx,
        ctx.tenantId,
        {
          id: deps.newId(),
          timetableId: timetable.id,
          kind: "LESSON",
          classroomId: p.classroomId,
          curriculumNodeId: p.curriculumNodeId,
          offeringId: null,
          claimsClassroom: true,
          weekday: p.weekday,
          startMinute: sh * 60 + sm,
          endMinute: eh * 60 + em,
          timeSlotId: p.periods === 1 ? p.timeSlotId : null,
          roomId: p.roomId,
          weekPattern: "EVERY",
          validFrom: null,
          validTo: null,
          deliveryMode: "IN_PERSON",
          title: null,
          notes: `Proposition automatique ${run.id.slice(0, 8)}`,
          staff: p.teacherId ? [{ staffId: p.teacherId, role: "LEAD" }] : [],
          equipment: [],
        },
        now,
      );
    }

    // Contrôle final : aucun conflit entre patrons du brouillon obtenu.
    const entries = await tt.listEntries(tx, timetable.id);
    const policies = await ref.getPolicies(tx, run.institutionId);
    const conflicts = await classifyEntryConflictsFor(deps, ctx, tx, detectEntryConflicts(entries, timetable), policies);
    if (hasBlocking(conflicts)) {
      return err(new ConflictError(`L'application introduirait ${conflicts.filter((c) => c.severity === "BLOCKING").length} conflit(s) : relancez la génération.`, { code: SchedulingCodes.autogenInvariant }));
    }

    // Information à jour au moment de l'application : un emploi du temps publié existe-t-il déjà pour cette année / période ?
    const published = (await tt.listTimetables(tx, { institutionId: run.institutionId, academicYearId: run.academicYearId, status: "PUBLISHED" })).find(
      (t) => (t.periodId ?? null) === (run.periodId ?? null) && (t.campusId ?? null) === (run.campusId ?? null),
    );
    const applied = await repo.markApplied(tx, run.id, timetable.id, ctx.userId, now);
    buf.add(SchedulingEvents.autogenRunApplied, { v: 1, runId: run.id, institutionId: run.institutionId, timetableId: timetable.id, entries: result.placements.length, mode }, { type: RUN_AGGREGATE, id: run.id });
    buf.audit({ action: "scheduling.autogen_run.applied", resourceType: RUN_AGGREGATE, resourceId: run.id, metadata: { timetableId: timetable.id, mode, entries: result.placements.length, replaced, unplaced: result.score.unplacedSessions } });
    await buf.flush(tx);
    return ok({ run: applied, timetable, entriesCreated: result.placements.length, entriesReplaced: replaced, unplacedSessions: result.score.unplacedSessions, publishedTimetable: published ? { id: published.id, name: published.name } : null });
  });
}

