/**
 * Cycle de vie d'une période : verrouiller, délibérer, clôturer, rouvrir, re-pinner.
 *
 *   OPEN ──lock──► GRADING_LOCKED ──deliberate──► DELIBERATED ──close──► CLOSED ──reopen──► OPEN
 *
 *  - `lock` : refuse si des évaluations de la classe et de la période ne sont pas publiées (liste renvoyée) ; forçage
 *    possible avec motif (direction). Pose le verrou des notes (`assess`, par session) dans la MÊME transaction.
 *  - `deliberate` : exige une délibération TENUE (conseil / jury) ; confirme au besoin les décisions proposées.
 *  - `close` : recalcule TOUS les inscrits en résultats FINAL (avec trace), calcule le hash de clôture (agrégat des
 *    `outputs_hash`), supersède les anciens FINAL, bascule en CLOSED — UNE transaction : règle indisponible ⇒ rien ne change.
 *    Refusée tant qu'une inscription est en ERREUR (liste), sauf forçage avec exclusion explicite et motif.
 *  - `reopen` : motif obligatoire, droit sensible ; CORRECTION libère toutes les sessions, RESIT_SESSION seulement la 2.
 *    La prochaine clôture crée des résultats FINAL en version n+1 (les anciens restent SUPERSEDED, consultables).
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { Tx } from "@ecoledigitale/database";
import { ResultsCode, conflict, forbidden, notFound, validation } from "../domain/errors";
import { ResultsEvents } from "../domain/events";
import { closureHashOf } from "../domain/hash";
import { planClose, planDeliberate, planLock, planReopen } from "../domain/period-state";
import type { DecisionRecord, PeriodState } from "../domain/records";
import type { ReopenKind } from "../domain/types";
import { guarded } from "../infrastructure/db-errors";
import { confirmDecision, listDecisions, listDeliberations, upsertProposal, withdrawConfirmedDecisions } from "../infrastructure/governance-repository";
import { insertHeader, insertLines, listCurrentHeaders, listDraftHeaders, listFinalHeaders, markSuperseded, maxVersions } from "../infrastructure/results-repository";
import { getSettingsRow, getStateByKey, getStateById, insertClosure, repinState, transitionState } from "../infrastructure/states-repository";
import { computeDraftInTx, prepare, proposalsOf, runPipeline } from "./compute";
import { EventBuffer, inTx, lockKey, type ResultsCaps, type ResultsDeps } from "./deps";
import type { RulePin } from "./ports";
import { requestRecompute } from "./recompute";

const needCap = (ok1: boolean | undefined, message: string): Result<void, AppError> => (ok1 ? ok(undefined) : err(forbidden(ResultsCode.FORBIDDEN, message)));

async function loadStateForUpdate(tx: Tx, input: { classroomId: string; academicPeriodId: string }, academicYearId: string): Promise<PeriodState | null> {
  return getStateByKey(tx, { classroomId: input.classroomId, academicPeriodId: input.academicPeriodId, academicYearId, scope: "PERIOD" }, "update");
}

export interface PeriodRef {
  classroomId: string;
  academicPeriodId: string;
  caps?: ResultsCaps | undefined;
}

// ---------------------------------------------------------------------------------------------------------------------
// Verrouillage
// ---------------------------------------------------------------------------------------------------------------------

export interface LockInput extends PeriodRef {
  force?: boolean | undefined;
  reason?: string | undefined;
}

export async function lockPeriod(deps: ResultsDeps, ctx: RequestContext, input: LockInput): Promise<Result<PeriodState, AppError>> {
  const caps = needCap(input.caps?.lock, "Vous n'avez pas le droit de verrouiller une période.");
  if (!caps.ok) return caps;
  if (!ctx.userId) return err(forbidden(ResultsCode.FORBIDDEN, "Un utilisateur authentifié est requis."));
  if (input.force && (input.reason?.trim().length ?? 0) < 10) {
    return err(validation(ResultsCode.JUSTIFICATION_REQUIRED, "Un verrouillage forcé exige un motif (10 caractères au moins).", "reason"));
  }
  return inTx(deps, ctx, async (tx) => {
    await lockKey(tx, ctx, input.classroomId, input.academicPeriodId);
    const prepared = await prepare(deps, ctx, tx, input);
    if (!prepared.ok) return prepared;
    const { state } = prepared.value;
    const plan = planLock(state.status);
    if (!plan.ok) return plan;
    if (plan.value.alreadyLocked) return ok(state);

    const events = new EventBuffer(deps, ctx);
    // État des calculs à jour AVANT de figer les notes : les décisions proposées reflètent les dernières notes publiées.
    const refreshed = await computeDraftInTx(deps, ctx, tx, events, prepared.value);
    if (!refreshed.ok) return refreshed;

    const locked = await deps.ports.assess.lock(ctx, tx, { classroomId: input.classroomId, academicPeriodId: input.academicPeriodId, sessions: [1, 2], force: input.force === true, reason: input.reason ?? null });
    if (!locked.ok) {
      const pending = (locked.error.details as { pending?: unknown } | undefined)?.pending;
      if (pending) return err(conflict(ResultsCode.PENDING_ASSESSMENTS, "Des évaluations de cette classe et de cette période ne sont pas publiées : publiez-les ou forcez le verrouillage avec un motif.", { pending }));
      return locked;
    }
    const next = await guarded(() => transitionState(tx, state.id, state.rowVersion, { to: "GRADING_LOCKED", by: ctx.userId as string, now: deps.clock.now() }));
    if (!next) return err(conflict(ResultsCode.STALE_STATE, "La période a été modifiée entre-temps : rechargez-la."));
    events.add(
      ResultsEvents.PERIOD_LOCKED,
      { v: 1, classroomId: input.classroomId, academicPeriodId: input.academicPeriodId, stateId: state.id, closureHash: null, resultsVersion: state.resultsVersion },
      { type: "period_state", id: state.id },
    );
    events.audit({
      action: "results.period.locked",
      entity: "period_state",
      entityId: state.id,
      before: { status: state.status },
      after: { status: next.status, forced: locked.value.pending.length > 0 },
      reason: input.reason ?? null,
      metadata: { pendingCount: locked.value.pending.length },
      severity: locked.value.pending.length > 0 ? "warning" : "notice",
    });
    await events.flush(tx);
    return ok(next);
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Délibération
// ---------------------------------------------------------------------------------------------------------------------

export interface DeliberateInput extends PeriodRef {
  /** Confirme les décisions PROPOSÉES telles que proposées (celles déjà confirmées ou modifiées restent). */
  confirmProposed?: boolean | undefined;
}

export async function deliberatePeriod(deps: ResultsDeps, ctx: RequestContext, input: DeliberateInput): Promise<Result<PeriodState, AppError>> {
  const caps = needCap(input.caps?.decisionRecord, "Vous n'avez pas le droit d'enregistrer une délibération.");
  if (!caps.ok) return caps;
  if (!ctx.userId) return err(forbidden(ResultsCode.FORBIDDEN, "Un utilisateur authentifié est requis."));
  return inTx(deps, ctx, async (tx) => {
    await lockKey(tx, ctx, input.classroomId, input.academicPeriodId);
    const structure = await deps.ports.curriculum.getStructure(ctx, input);
    if (!structure) return err(notFound(ResultsCode.CURRICULUM_UNAVAILABLE, "Structure du curriculum", `${input.classroomId}/${input.academicPeriodId}`));
    const state = await loadStateForUpdate(tx, input, structure.academicYearId);
    if (!state) return err(notFound(ResultsCode.STATE_NOT_FOUND, "État de la période", `${input.classroomId}/${input.academicPeriodId}`));
    const held = (await listDeliberations(tx, state.id)).some((d) => d.status === "HELD" || d.status === "SIGNED");
    const plan = planDeliberate(state.status, { heldDeliberation: held });
    if (!plan.ok) return plan;

    const events = new EventBuffer(deps, ctx);
    const actorName = await deps.ports.names.nameOf(ctx, ctx.userId as string);
    const now = deps.clock.now();
    let confirmed = 0;
    if (input.confirmProposed) {
      const heldDelib = (await listDeliberations(tx, state.id)).find((d) => d.status === "HELD" || d.status === "SIGNED");
      for (const d of await listDecisions(tx, { stateId: state.id, status: "PROPOSED" })) {
        if (!d.proposedCode) continue;
        const done = await guarded(() => confirmDecision(tx, { id: d.id, finalCode: d.proposedCode as string, finalOutcome: d.proposedOutcome as string, deliberationId: heldDelib?.id ?? null, justification: null, by: ctx.userId as string, byName: actorName, at: now }));
        if (done) {
          confirmed += 1;
          emitConfirmed(events, state, done);
        }
      }
    }
    const next = await guarded(() => transitionState(tx, state.id, state.rowVersion, { to: "DELIBERATED", by: ctx.userId as string, now }));
    if (!next) return err(conflict(ResultsCode.STALE_STATE, "La période a été modifiée entre-temps : rechargez-la."));
    events.add(ResultsEvents.PERIOD_DELIBERATED, { v: 1, classroomId: input.classroomId, academicPeriodId: input.academicPeriodId, stateId: state.id, closureHash: null, resultsVersion: state.resultsVersion }, { type: "period_state", id: state.id });
    events.audit({ action: "results.period.deliberated", entity: "period_state", entityId: state.id, before: { status: state.status }, after: { status: next.status }, metadata: { confirmed }, severity: "notice" });
    await events.flush(tx);
    return ok(next);
  });
}

export function emitConfirmed(events: EventBuffer, state: PeriodState, d: DecisionRecord): void {
  events.add(
    ResultsEvents.DECISION_CONFIRMED,
    { v: 1, enrollmentId: d.enrollmentId, scope: d.scope, kind: d.kind, finalCode: d.finalCode, outcome: d.finalOutcome, stateId: state.id, academicPeriodId: state.academicPeriodId, changedFromProposal: d.finalCode !== d.proposedCode },
    { type: "decision", id: d.id },
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Clôture
// ---------------------------------------------------------------------------------------------------------------------

export interface CloseInput extends PeriodRef {
  /** Clôture malgré des inscriptions en ERREUR : elles sont exclues (pas de résultat FINAL), avec motif. */
  force?: boolean | undefined;
  reason?: string | undefined;
}

export interface CloseOutcome {
  state: PeriodState;
  closureId: string;
  closureHash: string;
  resultsVersion: number;
  resultsCount: number;
  excluded: Array<{ enrollmentId: string; code: string; message: string }>;
  withoutDeliberation: boolean;
}

export async function closePeriod(deps: ResultsDeps, ctx: RequestContext, input: CloseInput): Promise<Result<CloseOutcome, AppError>> {
  const caps = needCap(input.caps?.close, "Vous n'avez pas le droit de clôturer une période.");
  if (!caps.ok) return caps;
  if (!ctx.userId) return err(forbidden(ResultsCode.FORBIDDEN, "Un utilisateur authentifié est requis."));
  if (input.force && (input.reason?.trim().length ?? 0) < 10) {
    return err(validation(ResultsCode.JUSTIFICATION_REQUIRED, "Une clôture forcée exige un motif (10 caractères au moins).", "reason"));
  }
  return inTx(deps, ctx, async (tx) => {
    await lockKey(tx, ctx, input.classroomId, input.academicPeriodId);
    const prepared = await prepare(deps, ctx, tx, input);
    if (!prepared.ok) return prepared;
    const { state, structure, session } = prepared.value;
    const settings = await getSettingsRow(tx);
    const plan = planClose(state.status, { requireDeliberation: settings.requireDeliberation });
    if (!plan.ok) return plan;

    const computed = await runPipeline(deps, ctx, tx, prepared.value, { withTrace: true });
    if (!computed.ok) return computed;
    const failed = computed.value.enrollments.filter((c) => c.error);
    if (failed.length > 0 && !input.force) {
      return err(
        conflict(ResultsCode.CALCULATION_ERRORS, "Des inscriptions ont un calcul en erreur : corrigez-les ou forcez la clôture avec exclusion explicite et motif.", {
          errors: failed.map((c) => ({ enrollmentId: c.enrollmentId, code: c.error?.code, message: c.error?.message, ruleKey: c.error?.ruleKey })),
        }),
      );
    }
    const good = computed.value.enrollments.filter((c) => !c.error && c.header && c.outputsHash);

    // Décisions CONFIRMÉES : leur proposition doit être celle des résultats finaux (sinon elles sont périmées).
    const confirmed = await listDecisions(tx, { stateId: state.id });
    const stale: string[] = [];
    for (const comp of good) {
      for (const p of proposalsOf(state.contractId, comp)) {
        const d = confirmed.find((x) => x.enrollmentId === comp.enrollmentId && x.kind === p.kind);
        if (d && d.status !== "PROPOSED" && d.proposedCode !== p.code) stale.push(`${comp.enrollmentId}/${p.kind}`);
      }
    }
    if (stale.length > 0) {
      return err(conflict(ResultsCode.DECISION_STALE, "Des décisions confirmées reposent sur un calcul périmé (surcharge approuvée depuis) : confirmez-les à nouveau.", { decisions: stale }));
    }

    const now = deps.clock.now();
    const events = new EventBuffer(deps, ctx);
    const actorName = await deps.ports.names.nameOf(ctx, ctx.userId as string);
    const resultsVersion = state.resultsVersion + 1;
    const closureHash = closureHashOf(good.map((c) => c.outputsHash as string));
    const excluded = failed.map((c) => ({ enrollmentId: c.enrollmentId, code: c.error?.code ?? "unknown", message: c.error?.message ?? "" }));
    const closureId = deps.newId();
    await guarded(() =>
      insertClosure(tx, { id: closureId, tenantId: ctx.tenantId, stateId: state.id, resultsVersion, resultsCount: good.length, closureHash, excluded, forcedReason: input.force ? (input.reason ?? null) : null, closedBy: ctx.userId as string, closedByName: actorName, now }),
    );

    // Anciens résultats : le FINAL précédent devient SUPERSEDED (consultable), les brouillons aussi.
    const current = await listCurrentHeaders(tx, state.id, "FINAL");
    const previousFinal = (await listFinalHeaders(tx, state.id)).map((h) => h.id);
    await guarded(() => markSuperseded(tx, previousFinal, now));
    const drafts = (await listDraftHeaders(tx, state.id)).map((h) => h.id);
    await guarded(() => markSuperseded(tx, drafts, now));
    const supersedes = new Map(current.map((h) => [h.enrollmentId, h.id]));
    const versions = await maxVersions(tx, state.id);

    for (const comp of good) {
      const id = deps.newId();
      const version = (versions.get(comp.enrollmentId) ?? 0) + 1;
      await guarded(async () => {
        await insertHeader(tx, {
          id,
          tenantId: ctx.tenantId,
          stateId: state.id,
          enrollmentId: comp.enrollmentId,
          studentId: comp.studentId,
          classroomId: structure.classroomId,
          academicPeriodId: structure.period.id,
          academicYearId: structure.academicYearId,
          scope: "PERIOD",
          version,
          status: "FINAL",
          contractId: state.contractId,
          ruleVersionKind: state.ruleVersionKind,
          ruleVersionId: state.ruleVersionId,
          ruleSetCode: state.ruleSetCode,
          ruleVersionNo: state.ruleVersionNo,
          definitionHash: state.definitionHash,
          engineVersion: session.engineVersion,
          inputsHash: comp.inputsHash,
          outputsHash: comp.outputsHash,
          inputs: comp.inputs,
          error: null,
          header: comp.header,
          closureId,
          lineCount: comp.lines.length,
          finalizedAt: now,
          supersedesId: supersedes.get(comp.enrollmentId) ?? null,
          now,
        });
        await insertLines(tx, ctx.tenantId, id, comp.lines, deps.newId);
      });
      // la proposition suit le résultat FINAL (tant qu'elle n'est pas confirmée)
      for (const p of proposalsOf(state.contractId, comp)) {
        await upsertProposal(tx, { id: deps.newId(), tenantId: ctx.tenantId, stateId: state.id, enrollmentId: p.enrollmentId, scope: p.scope, kind: p.kind, sourceResultId: id, code: p.code, outcome: p.outcome });
      }
    }

    // Sans délibération : les décisions proposées sont confirmées par la clôture elle-même (tracé, pas de date de séance inventée).
    if (plan.value.withoutDeliberation) {
      for (const d of await listDecisions(tx, { stateId: state.id, status: "PROPOSED" })) {
        if (!d.proposedCode) continue;
        const done = await guarded(() => confirmDecision(tx, { id: d.id, finalCode: d.proposedCode as string, finalOutcome: d.proposedOutcome as string, deliberationId: null, justification: null, by: ctx.userId as string, byName: actorName, at: now }));
        if (done) emitConfirmed(events, state, done);
      }
    }

    const next = await guarded(() => transitionState(tx, state.id, state.rowVersion, { to: "CLOSED", by: ctx.userId as string, now, resultsVersion }));
    if (!next) return err(conflict(ResultsCode.STALE_STATE, "La période a été modifiée entre-temps : rechargez-la."));
    events.add(
      ResultsEvents.PERIOD_CLOSED,
      { v: 1, classroomId: input.classroomId, academicPeriodId: input.academicPeriodId, stateId: state.id, closureHash, resultsVersion, withoutDeliberation: plan.value.withoutDeliberation },
      { type: "period_state", id: state.id },
    );
    events.audit({
      action: "results.period.closed",
      entity: "period_state",
      entityId: state.id,
      before: { status: state.status, resultsVersion: state.resultsVersion },
      after: { status: next.status, resultsVersion, closureHash },
      reason: input.force ? (input.reason ?? null) : null,
      metadata: { resultsCount: good.length, excluded: excluded.length, withoutDeliberation: plan.value.withoutDeliberation },
      severity: failed.length > 0 ? "warning" : "critical",
    });
    await events.flush(tx);
    return ok({ state: next, closureId, closureHash, resultsVersion, resultsCount: good.length, excluded, withoutDeliberation: plan.value.withoutDeliberation });
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Réouverture
// ---------------------------------------------------------------------------------------------------------------------

export interface ReopenInput extends PeriodRef {
  kind: ReopenKind;
  reason: string;
}

export async function reopenPeriod(deps: ResultsDeps, ctx: RequestContext, input: ReopenInput): Promise<Result<PeriodState, AppError>> {
  const caps = needCap(input.caps?.reopen, "Vous n'avez pas le droit de rouvrir une période clôturée.");
  if (!caps.ok) return caps;
  if (!ctx.userId) return err(forbidden(ResultsCode.FORBIDDEN, "Un utilisateur authentifié est requis."));
  return inTx(deps, ctx, async (tx) => {
    await lockKey(tx, ctx, input.classroomId, input.academicPeriodId);
    const structure = await deps.ports.curriculum.getStructure(ctx, input);
    if (!structure) return err(notFound(ResultsCode.CURRICULUM_UNAVAILABLE, "Structure du curriculum", `${input.classroomId}/${input.academicPeriodId}`));
    const state = await loadStateForUpdate(tx, input, structure.academicYearId);
    if (!state) return err(notFound(ResultsCode.STATE_NOT_FOUND, "État de la période", `${input.classroomId}/${input.academicPeriodId}`));
    const plan = planReopen(state.status, { kind: input.kind, reason: input.reason });
    if (!plan.ok) return plan;

    // Les notes : CORRECTION libère toutes les sessions ; RESIT_SESSION seulement la session 2 (session 1 reste verrouillée).
    const released =
      input.kind === "RESIT_SESSION"
        ? await deps.ports.assess.releaseSession2(ctx, tx, { classroomId: input.classroomId, academicPeriodId: input.academicPeriodId, reason: input.reason })
        : await deps.ports.assess.unlock(ctx, tx, { classroomId: input.classroomId, academicPeriodId: input.academicPeriodId, reason: input.reason });
    if (!released.ok) return released;

    const next = await guarded(() => transitionState(tx, state.id, state.rowVersion, { to: "OPEN", now: deps.clock.now(), reopen: { kind: input.kind, reason: input.reason.trim() } }));
    if (!next) return err(conflict(ResultsCode.STALE_STATE, "La période a été modifiée entre-temps : rechargez-la."));
    const withdrawn = await guarded(() => withdrawConfirmedDecisions(tx, state.id));
    const events = new EventBuffer(deps, ctx);
    events.add(
      ResultsEvents.PERIOD_REOPENED,
      { v: 1, classroomId: input.classroomId, academicPeriodId: input.academicPeriodId, stateId: state.id, closureHash: null, resultsVersion: state.resultsVersion, reopenKind: input.kind, reason: input.reason.trim() },
      { type: "period_state", id: state.id },
    );
    events.audit({
      action: "results.period.reopened",
      entity: "period_state",
      entityId: state.id,
      before: { status: state.status, resultsVersion: state.resultsVersion },
      after: { status: next.status, reopenCount: next.reopenCount, kind: input.kind, decisionsWithdrawn: withdrawn },
      reason: input.reason.trim(),
      severity: "critical",
    });
    await events.flush(tx);
    // La période rouverte est recalculée (brouillons) à la prochaine échéance de la file.
    await requestRecompute(deps, ctx, { classroomId: input.classroomId, academicPeriodId: input.academicPeriodId, cause: { event: "results.period.reopened", id: state.id }, tx });
    return ok(next);
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Re-pin sur la version de règle active
// ---------------------------------------------------------------------------------------------------------------------

/** Effet d'un changement de version de règle sur les résultats courants de la classe (SIMULATION : rien n'est écrit). */
export interface RepinSimulation {
  from: { ruleSetCode: string; ruleVersionNo: number; definitionHash: string };
  to: { ruleSetCode: string; ruleVersionNo: number; definitionHash: string };
  computed: number;
  changed: number;
  unchanged: number;
  errors: number;
  /** Premières différences (au plus 20) : inscription, champ, avant, après. */
  samples: Array<{ enrollmentId: string; field: string; before: string | number | boolean | null; after: string | number | boolean | null }>;
}

const SIMULATED_FIELDS = ["average", "rank", "decisionCode", "validated", "mentionCode", "creditsAcquired"] as const;

/**
 * Rejoue le pipeline de la classe sous la version de règle ACTIVE et la compare à la version épinglée, sans rien écrire.
 * Les données (notes publiées, surcharges) sont celles du moment : seule la version de règle change.
 */
async function simulateRepin(deps: ResultsDeps, ctx: RequestContext, tx: Tx, input: PeriodRef, pin: RulePin & { contractId: string }): Promise<Result<RepinSimulation, AppError>> {
  const prepared = await prepare(deps, ctx, tx, input);
  if (!prepared.ok) return prepared;
  const before = await runPipeline(deps, ctx, tx, prepared.value, { withTrace: false });
  if (!before.ok) return before;
  const session = await deps.ports.rules.open(ctx, pin);
  if (!session.ok) return session;
  const after = await runPipeline(deps, ctx, tx, { ...prepared.value, session: session.value }, { withTrace: false });
  if (!after.ok) return after;
  const afterOf = new Map(after.value.enrollments.map((c) => [c.enrollmentId, c]));
  const sim: RepinSimulation = {
    from: { ruleSetCode: prepared.value.state.ruleSetCode, ruleVersionNo: prepared.value.state.ruleVersionNo, definitionHash: prepared.value.state.definitionHash },
    to: { ruleSetCode: pin.ruleSetCode, ruleVersionNo: pin.ruleVersionNo, definitionHash: pin.definitionHash },
    computed: before.value.enrollments.length,
    changed: 0,
    unchanged: 0,
    errors: 0,
    samples: [],
  };
  for (const b of before.value.enrollments) {
    const a = afterOf.get(b.enrollmentId);
    if (!a || a.error) {
      sim.errors += 1;
      continue;
    }
    const diffs = SIMULATED_FIELDS.filter((f) => (b.header?.[f] ?? null) !== (a.header?.[f] ?? null));
    if (diffs.length === 0) sim.unchanged += 1;
    else {
      sim.changed += 1;
      for (const f of diffs) if (sim.samples.length < 20) sim.samples.push({ enrollmentId: b.enrollmentId, field: f, before: b.header?.[f] ?? null, after: a.header?.[f] ?? null });
    }
  }
  return ok(sim);
}

export async function repinPeriod(deps: ResultsDeps, ctx: RequestContext, input: PeriodRef): Promise<Result<{ state: PeriodState; changed: boolean; simulation: RepinSimulation | null }, AppError>> {
  const caps = needCap(input.caps?.repin, "Vous n'avez pas le droit de changer la version de règle d'une période.");
  if (!caps.ok) return caps;
  return inTx<{ state: PeriodState; changed: boolean; simulation: RepinSimulation | null }>(deps, ctx, async (tx) => {
    await lockKey(tx, ctx, input.classroomId, input.academicPeriodId);
    const structure = await deps.ports.curriculum.getStructure(ctx, input);
    if (!structure) return err(notFound(ResultsCode.CURRICULUM_UNAVAILABLE, "Structure du curriculum", `${input.classroomId}/${input.academicPeriodId}`));
    const state = await loadStateForUpdate(tx, input, structure.academicYearId);
    if (!state) return err(notFound(ResultsCode.STATE_NOT_FOUND, "État de la période", `${input.classroomId}/${input.academicPeriodId}`));
    if (state.status !== "OPEN") return err(conflict(ResultsCode.REPIN_NOT_ALLOWED, "La version de règle ne peut être changée que sur une période ouverte.", { status: state.status }));
    const resolved = await deps.ports.rules.resolve(ctx, { contractId: state.contractId, institutionId: structure.institutionId, levelCode: structure.levelCode, date: structure.period.startsOn });
    if (!resolved.ok) return resolved;
    if (!resolved.value) return err(conflict(ResultsCode.NO_ACTIVE_RULESET, "Aucun jeu de règles actif pour cette période.", { contractId: state.contractId }));
    const pin = resolved.value;
    if (pin.ruleVersionId === state.ruleVersionId && pin.definitionHash === state.definitionHash) return ok({ state, changed: false, simulation: null });
    // simulation préalable, jointe à la réponse : l'effet sur les résultats est connu AVANT que le recalcul ne les remplace
    const simulation = await simulateRepin(deps, ctx, tx, input, pin);
    if (!simulation.ok) return simulation;
    const next = await guarded(() => repinState(tx, state.id, pin, ctx.userId, deps.clock.now()));
    const events = new EventBuffer(deps, ctx);
    events.audit({
      action: "results.period.repinned",
      entity: "period_state",
      entityId: state.id,
      before: { ruleVersionId: state.ruleVersionId, ruleVersionNo: state.ruleVersionNo },
      after: { ruleVersionId: next.ruleVersionId, ruleVersionNo: next.ruleVersionNo },
      metadata: { changed: simulation.value.changed, unchanged: simulation.value.unchanged, errors: simulation.value.errors },
      severity: "warning",
    });
    await events.flush(tx);
    await requestRecompute(deps, ctx, { classroomId: input.classroomId, academicPeriodId: input.academicPeriodId, cause: { event: "results.period.repinned", id: state.id }, tx });
    return ok({ state: next, changed: true, simulation: simulation.value });
  });
}

export { getStateById };
