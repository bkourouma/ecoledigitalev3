/**
 * Port d'ÉCRITURE pour les conseils (spec 006 §7.3 `ResultsWritePort`, spec 005 T-P02) : les décisions de passage / redoublement,
 * les appréciations générales et les distinctions décidées par un conseil de classe (secondaire) ou un conseil des maîtres
 * (primaire) sont écrites dans `results` par CETTE API publique, jamais par du SQL externe.
 *
 *  - TRACÉ ET AUDITÉ : chaque écriture porte l'identité de l'utilisateur qui agit (`ctx.userId`, nom figé), la référence OPAQUE de
 *    l'acte source du conseil (`actor.councilRef`) et le module appelant (`actor.source`) ; audit dans la même transaction ;
 *    événement `results.decision.confirmed` (inchangé) pour une décision.
 *  - L'humain décide : une décision d'année exige un code FINAL du contrat (jamais `COUNCIL_REVIEW`, qui n'est pas une décision) ;
 *    trancher une proposition « la règle ne tranche pas » n'est pas un écart ; s'écarter d'une proposition de règle exige une
 *    justification (R-RES-05, comme pour la direction). Aucune formule ici : les codes permis viennent du contrat.
 *  - IDEMPOTENT : réécrire la même décision (même code, même délibération) ne change rien et n'émet rien.
 *  - Une période CLÔTURÉE est figée : l'écriture est refusée (`results.state_closed`).
 *  - Les capacités RBAC du conseil (`council.*`, `primary.council.*`) sont vérifiées par le module appelant ; ici, seule la
 *    nature de l'acte est contrôlée.
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import { getContract } from "../../rules";
import { DECISION_RULES, YEAR_END_FINAL_CODES, isFinalDecisionCode, outcomeOf } from "../domain/catalog";
import { ResultsCode, conflict, forbidden, notFound, validation } from "../domain/errors";
import type { AppreciationRecord, DecisionRecord, DeliberationRecord, PeriodState } from "../domain/records";
import { guarded } from "../infrastructure/db-errors";
import { confirmDecision, getDecision, getDeliberation, insertCouncilDecision, listDecisions, restoreRuleProposal, upsertAppreciation, withdrawDecisionRow } from "../infrastructure/governance-repository";
import { getStateById } from "../infrastructure/states-repository";
import { EventBuffer, inTx, type ResultsCaps, type ResultsDeps } from "./deps";
import { requestRecompute } from "./recompute";
import { ResultsEvents } from "../domain/events";
import { createDeliberation, updateDeliberationUseCase } from "./governance";
import { emitConfirmed } from "./lifecycle";

/** Modules autorisés à écrire pour un conseil. */
export const COUNCIL_WRITE_SOURCES = ["councils", "primary_school"] as const;
export type CouncilWriteSource = (typeof COUNCIL_WRITE_SOURCES)[number];

/** Qui écrit : module appelant et référence OPAQUE de l'acte source (séance, décision du conseil). */
export interface CouncilActor {
  readonly source: CouncilWriteSource;
  readonly councilRef: string;
}

/** Capacités internes de l'API d'écriture : le contrôle d'accès du conseil a déjà eu lieu côté module appelant. */
const COUNCIL_CAPS: ResultsCaps = Object.freeze({ read: true, decisionRecord: true, decisionApprove: true, appreciationWrite: true });

const DISTINCTION_CODE = /^[A-Z][A-Z0-9_]{1,40}$/;

function checkActor(actor: CouncilActor): Result<void, AppError> {
  if (!(COUNCIL_WRITE_SOURCES as readonly string[]).includes(actor.source)) {
    return err(forbidden(ResultsCode.COUNCIL_WRITE_REJECTED, `Le module « ${actor.source} » n'est pas autorisé à écrire pour un conseil.`));
  }
  if (!actor.councilRef || actor.councilRef.length > 100) {
    return err(validation(ResultsCode.COUNCIL_WRITE_REJECTED, "La référence de l'acte du conseil est obligatoire (100 caractères au plus).", "councilRef"));
  }
  return ok(undefined);
}

async function loadOpenState(tx: Parameters<typeof getStateById>[0], stateId: string): Promise<Result<PeriodState, AppError>> {
  const state = await getStateById(tx, stateId, "share");
  if (!state) return err(notFound(ResultsCode.STATE_NOT_FOUND, "État de la période", stateId));
  if (state.status === "CLOSED") return err(conflict(ResultsCode.STATE_CLOSED, "La période est clôturée : les décisions sont figées.", { stateId }));
  return ok(state);
}

/** Codes permis pour une décision finale de fin d'année : ceux du contrat (jamais le code de renvoi au conseil). */
function allowedYearCodes(contractId: string): readonly string[] {
  const explicit = YEAR_END_FINAL_CODES[contractId];
  if (explicit) return explicit;
  const ruleKey = DECISION_RULES[contractId]?.find((r) => r.kind === "YEAR_END")?.ruleKey;
  const codes = ruleKey ? (getContract(contractId)?.rules.find((r) => r.key === ruleKey)?.outputCodes ?? []) : [];
  return codes.filter(isFinalDecisionCode);
}

// ---------------------------------------------------------------------------------------------------------------------
// Séance
// ---------------------------------------------------------------------------------------------------------------------

export interface OpenCouncilDeliberationInput {
  readonly stateId: string;
  readonly heldOn?: string | undefined;
  readonly participants?: ReadonlyArray<{ staffId: string; role: string }> | undefined;
  readonly actor: CouncilActor;
}

/** Ouvre la délibération (`kind = COUNCIL`) d'un conseil sur l'état d'une période ; les participants sont fournis par le module appelant. */
export async function openCouncilDeliberation(deps: ResultsDeps, ctx: RequestContext, input: OpenCouncilDeliberationInput): Promise<Result<DeliberationRecord, AppError>> {
  const actor = checkActor(input.actor);
  if (!actor.ok) return actor;
  return createDeliberation(deps, ctx, { stateId: input.stateId, kind: "COUNCIL", heldOn: input.heldOn, participants: input.participants, caps: COUNCIL_CAPS });
}

export interface MarkDeliberationHeldInput {
  readonly deliberationId: string;
  /** Date RÉELLE de la séance (« AAAA-MM-JJ »). */
  readonly heldOn: string;
  readonly participants?: ReadonlyArray<{ staffId: string; role: string }> | undefined;
  readonly minutesObjectKey?: string | undefined;
  readonly actor: CouncilActor;
}

/** Marque la délibération `HELD` à la clôture de la séance du conseil (date réelle obligatoire). */
export async function markDeliberationHeld(deps: ResultsDeps, ctx: RequestContext, input: MarkDeliberationHeldInput): Promise<Result<DeliberationRecord, AppError>> {
  const actor = checkActor(input.actor);
  if (!actor.ok) return actor;
  return updateDeliberationUseCase(deps, ctx, { deliberationId: input.deliberationId, status: "HELD", heldOn: input.heldOn, participants: input.participants, minutesObjectKey: input.minutesObjectKey, caps: COUNCIL_CAPS });
}

// ---------------------------------------------------------------------------------------------------------------------
// Décision de passage / redoublement
// ---------------------------------------------------------------------------------------------------------------------

export interface PublishYearDecisionInput {
  readonly stateId: string;
  readonly enrollmentId: string;
  /** Code FINAL du contrat (ex. `PROMOTED`, `REPEAT`) ; jamais `COUNCIL_REVIEW`. */
  readonly finalCode: string;
  readonly deliberationId?: string | undefined;
  /** Obligatoire (20 caractères) quand le conseil s'écarte d'une proposition de règle ferme (R-RES-05). */
  readonly justification?: string | undefined;
  readonly actor: CouncilActor;
}

/**
 * Crée ou confirme la décision de portée ANNÉE (`kind = YEAR_END`) d'une inscription : confirme la proposition de la règle (même
 * code ou « la règle ne tranche pas »), la remplace avec justification, ou crée la décision quand aucune règle ne l'a proposée.
 */
export async function publishYearDecision(deps: ResultsDeps, ctx: RequestContext, input: PublishYearDecisionInput): Promise<Result<DecisionRecord, AppError>> {
  const actorCheck = checkActor(input.actor);
  if (!actorCheck.ok) return actorCheck;
  if (!ctx.userId) return err(forbidden(ResultsCode.FORBIDDEN, "Un utilisateur authentifié est requis."));
  if (!isFinalDecisionCode(input.finalCode)) {
    return err(validation(ResultsCode.DECISION_NOT_FINAL, `« ${input.finalCode} » n'est pas une décision : le conseil doit trancher en indiquant le code final (passage, redoublement…).`, "finalCode"));
  }
  return inTx(deps, ctx, async (tx) => {
    const loaded = await loadOpenState(tx, input.stateId);
    if (!loaded.ok) return loaded;
    const state = loaded.value;
    const allowed = allowedYearCodes(state.contractId);
    if (allowed.length > 0 && !allowed.includes(input.finalCode)) {
      return err(validation(ResultsCode.INVALID_INPUT, `« ${input.finalCode} » n'est pas un code permis pour la décision de fin d'année (${allowed.join(", ")}).`, "finalCode"));
    }
    if (input.deliberationId) {
      const delib = await getDeliberation(tx, input.deliberationId);
      if (!delib || delib.stateId !== state.id) return err(notFound(ResultsCode.DELIBERATION_NOT_FOUND, "Délibération", input.deliberationId));
    }
    const actorName = await deps.ports.names.nameOf(ctx, ctx.userId as string);
    const now = deps.clock.now();
    const existing = (await listDecisions(tx, { stateId: state.id, enrollmentId: input.enrollmentId })).find((d) => d.kind === "YEAR_END");
    const events = new EventBuffer(deps, ctx);
    let done: DecisionRecord | null;
    let deviates = false;

    if (existing && existing.status === "PUBLISHED") {
      return err(conflict(ResultsCode.DECISION_TRANSITION, "Cette décision est publiée : elle ne change plus.", { status: existing.status }));
    }
    if (existing) {
      if (existing.status === "CONFIRMED" && existing.finalCode === input.finalCode && (existing.deliberationId ?? null) === (input.deliberationId ?? null)) return ok(existing); // idempotent
      const changed = input.finalCode !== existing.proposedCode;
      const deferred = existing.proposedCode !== null && !isFinalDecisionCode(existing.proposedCode);
      deviates = changed && existing.proposedCode !== null && !deferred;
      if (deviates && (input.justification?.trim().length ?? 0) < 20) {
        return err(validation(ResultsCode.JUSTIFICATION_REQUIRED, "Une décision différente de la proposition de la règle exige une justification (20 caractères au moins).", "justification"));
      }
      done = await guarded(() =>
        confirmDecision(tx, {
          id: existing.id,
          finalCode: input.finalCode,
          finalOutcome: outcomeOf(input.finalCode),
          deliberationId: input.deliberationId ?? null,
          justification: changed && (input.justification?.trim().length ?? 0) > 0 ? (input.justification as string).trim() : null,
          by: ctx.userId as string,
          byName: actorName,
          at: now,
          councilRef: input.actor.councilRef,
        }),
      );
      if (!done) return err(conflict(ResultsCode.DECISION_TRANSITION, "La décision a été traitée entre-temps.", {}));
    } else {
      done = await guarded(() =>
        insertCouncilDecision(tx, {
          id: deps.newId(),
          tenantId: ctx.tenantId,
          stateId: state.id,
          enrollmentId: input.enrollmentId,
          scope: "YEAR",
          kind: "YEAR_END",
          finalCode: input.finalCode,
          finalOutcome: outcomeOf(input.finalCode),
          deliberationId: input.deliberationId ?? null,
          councilRef: input.actor.councilRef,
          by: ctx.userId as string,
          byName: actorName,
          at: now,
        }),
      );
      if (!done) return err(conflict(ResultsCode.DECISION_TRANSITION, "Une décision de fin d'année existe déjà pour cette inscription.", {}));
    }
    emitConfirmed(events, state, done);
    events.audit({
      action: "results.decision.published_by_council",
      entity: "decision",
      entityId: done.id,
      before: { proposed: done.proposedCode },
      after: { final: done.finalCode, outcome: done.finalOutcome },
      reason: done.justification,
      metadata: { source: input.actor.source, councilRef: input.actor.councilRef, origin: done.origin, deliberationId: done.deliberationId },
      severity: deviates ? "warning" : "notice",
    });
    await events.flush(tx);
    return ok(done);
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Distinction
// ---------------------------------------------------------------------------------------------------------------------

export interface RecordDistinctionInput {
  readonly stateId: string;
  readonly enrollmentId: string;
  /** Code de la distinction (ex. `HONOR_ROLL`) : un CODE, jamais un libellé ; les libellés sont des données du jeu de règles. */
  readonly distinctionCode: string;
  readonly scope?: "PERIOD" | "YEAR" | undefined;
  readonly deliberationId?: string | undefined;
  readonly actor: CouncilActor;
}

/** Écrit la distinction décidée par le conseil (`kind = DISTINCTION`, sans proposition de règle) ; idempotent. */
export async function recordDistinction(deps: ResultsDeps, ctx: RequestContext, input: RecordDistinctionInput): Promise<Result<DecisionRecord, AppError>> {
  const actorCheck = checkActor(input.actor);
  if (!actorCheck.ok) return actorCheck;
  if (!ctx.userId) return err(forbidden(ResultsCode.FORBIDDEN, "Un utilisateur authentifié est requis."));
  if (!DISTINCTION_CODE.test(input.distinctionCode)) return err(validation(ResultsCode.INVALID_INPUT, "Code de distinction invalide (majuscules, chiffres et _).", "distinctionCode"));
  return inTx(deps, ctx, async (tx) => {
    const loaded = await loadOpenState(tx, input.stateId);
    if (!loaded.ok) return loaded;
    const state = loaded.value;
    if (input.deliberationId) {
      const delib = await getDeliberation(tx, input.deliberationId);
      if (!delib || delib.stateId !== state.id) return err(notFound(ResultsCode.DELIBERATION_NOT_FOUND, "Délibération", input.deliberationId));
    }
    const existing = (await listDecisions(tx, { stateId: state.id, enrollmentId: input.enrollmentId })).find((d) => d.kind === "DISTINCTION");
    if (existing?.status === "PUBLISHED") return err(conflict(ResultsCode.DECISION_TRANSITION, "Cette distinction est publiée : elle ne change plus.", {}));
    if (existing?.status === "CONFIRMED" && existing.finalCode === input.distinctionCode) return ok(existing); // idempotent
    const actorName = await deps.ports.names.nameOf(ctx, ctx.userId as string);
    const now = deps.clock.now();
    let done: DecisionRecord | null;
    if (existing) {
      done = await guarded(() => confirmDecision(tx, { id: existing.id, finalCode: input.distinctionCode, finalOutcome: "OTHER", deliberationId: input.deliberationId ?? null, justification: null, by: ctx.userId as string, byName: actorName, at: now, councilRef: input.actor.councilRef }));
    } else {
      done = await guarded(() =>
        insertCouncilDecision(tx, {
          id: deps.newId(), tenantId: ctx.tenantId, stateId: state.id, enrollmentId: input.enrollmentId, scope: input.scope ?? "YEAR", kind: "DISTINCTION",
          finalCode: input.distinctionCode, finalOutcome: "OTHER", deliberationId: input.deliberationId ?? null, councilRef: input.actor.councilRef, by: ctx.userId as string, byName: actorName, at: now,
        }),
      );
    }
    if (!done) return err(conflict(ResultsCode.DECISION_TRANSITION, "La distinction a été traitée entre-temps.", {}));
    const events = new EventBuffer(deps, ctx);
    emitConfirmed(events, state, done);
    events.audit({
      action: "results.distinction.recorded_by_council",
      entity: "decision",
      entityId: done.id,
      after: { distinction: done.finalCode, scope: done.scope },
      metadata: { source: input.actor.source, councilRef: input.actor.councilRef, deliberationId: done.deliberationId },
      severity: "notice",
    });
    await events.flush(tx);
    return ok(done);
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Retrait d'une décision ou d'une distinction
// ---------------------------------------------------------------------------------------------------------------------

export interface WithdrawCouncilDecisionInput {
  /** Décision (de fin d'année) ou distinction à retirer : l'identifiant renvoyé par `publishYearDecision` / `recordDistinction`. */
  readonly decisionId: string;
  /** Motif obligatoire (10 caractères au moins) : conservé avec le retrait et dans l'audit, jamais dans un événement. */
  readonly reason: string;
  readonly actor: CouncilActor;
}

/**
 * Retire UNE décision ou distinction écrite pour un conseil (réouverture du conseil, erreur de saisie) — jusqu'ici seule la
 * réouverture de la période les retirait, en masse.
 *
 *  - TRACÉ ET AUDITÉ : qui retire (utilisateur authentifié, nom figé), quand, pourquoi, quel acte source (`councilRef`), quel
 *    module appelant ; audit `warning` dans la même transaction ; événement `results.decision.withdrawn` (identifiants et codes).
 *  - INTERDIT sur une période CLÔTURÉE (`results.state_closed`) et JAMAIS pour une décision PUBLIÉE (`results.decision_transition`) :
 *    une décision finale publiée au bulletin ne se retire pas par cette voie.
 *  - Seule une décision CONFIRMÉE se retire (`PROPOSED` n'est pas une décision ; une proposition de règle se remplace par le
 *    recalcul). Déjà retirée : IDEMPOTENT (rien n'est refait, rien n'est émis).
 *  - Une décision issue d'une RÈGLE (`origin = RULE`) : la proposition de la règle est RÉTABLIE dans la même transaction (le conseil peut
 *    redécider sur la même base ; la clôture ne voit pas de décision périmée) et un recalcul est demandé pour la rafraîchir ; une décision
 *    de CONSEIL n'a pas de proposition à restaurer.
 */
export async function withdrawCouncilDecision(deps: ResultsDeps, ctx: RequestContext, input: WithdrawCouncilDecisionInput): Promise<Result<DecisionRecord, AppError>> {
  const actorCheck = checkActor(input.actor);
  if (!actorCheck.ok) return actorCheck;
  if (!ctx.userId) return err(forbidden(ResultsCode.FORBIDDEN, "Un utilisateur authentifié est requis."));
  const reason = input.reason.trim();
  if (reason.length < 10) return err(validation(ResultsCode.INVALID_INPUT, "Le motif du retrait est obligatoire (10 caractères au moins).", "reason"));
  if (reason.length > 500) return err(validation(ResultsCode.INVALID_INPUT, "Le motif du retrait est limité à 500 caractères.", "reason"));
  return inTx(deps, ctx, async (tx) => {
    const found = await getDecision(tx, input.decisionId, true);
    if (!found) return err(notFound(ResultsCode.DECISION_NOT_FOUND, "Décision", input.decisionId));
    if (found.kind !== "YEAR_END" && found.kind !== "DISTINCTION") {
      return err(validation(ResultsCode.INVALID_INPUT, "Seules une décision de fin d'année et une distinction de conseil se retirent par cette voie.", "decisionId"));
    }
    if (found.status === "WITHDRAWN") return ok(found); // idempotent
    if (found.status === "PUBLISHED") return err(conflict(ResultsCode.DECISION_TRANSITION, "Cette décision est publiée : elle ne se retire pas.", { status: found.status }));
    if (found.status !== "CONFIRMED") return err(conflict(ResultsCode.DECISION_TRANSITION, "Seule une décision confirmée se retire : une proposition se remplace par le recalcul.", { status: found.status }));
    const loaded = await loadOpenState(tx, found.stateId);
    if (!loaded.ok) return loaded;
    const state = loaded.value;
    const actorName = await deps.ports.names.nameOf(ctx, ctx.userId as string);
    const withdrawn = await guarded(() => withdrawDecisionRow(tx, { id: found.id, by: ctx.userId as string, byName: actorName, reason, ref: input.actor.councilRef, at: deps.clock.now() }));
    if (!withdrawn) return err(conflict(ResultsCode.DECISION_TRANSITION, "La décision a été traitée entre-temps.", {}));
    const events = new EventBuffer(deps, ctx);
    events.add(
      ResultsEvents.DECISION_WITHDRAWN,
      { v: 1, decisionId: withdrawn.id, enrollmentId: withdrawn.enrollmentId, scope: withdrawn.scope, kind: withdrawn.kind, finalCode: found.finalCode, stateId: state.id, academicPeriodId: state.academicPeriodId, origin: withdrawn.origin },
      { type: "decision", id: withdrawn.id },
    );
    events.audit({
      action: "results.decision.withdrawn_by_council",
      entity: "decision",
      entityId: withdrawn.id,
      before: { status: "CONFIRMED", final: found.finalCode, outcome: found.finalOutcome },
      after: { status: "WITHDRAWN", kind: withdrawn.kind },
      reason,
      metadata: { source: input.actor.source, councilRef: input.actor.councilRef, origin: withdrawn.origin, stateId: state.id },
      severity: "warning",
    });
    await events.flush(tx);
    if (withdrawn.origin === "RULE") await restoreRuleProposal(tx, withdrawn.id, deps.newId());
    if (withdrawn.origin === "RULE" && state.academicPeriodId) {
      await requestRecompute(deps, ctx, { classroomId: state.classroomId, academicPeriodId: state.academicPeriodId, cause: { event: ResultsEvents.DECISION_WITHDRAWN, id: withdrawn.id }, tx });
    }
    return ok(withdrawn);
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Appréciation générale du conseil
// ---------------------------------------------------------------------------------------------------------------------

export interface WriteCouncilAppreciationInput {
  readonly stateId: string;
  readonly enrollmentId: string;
  /** Personnel (`people.staff`) qui rédige au nom du conseil (président, secrétaire, titulaire). */
  readonly authorStaffId: string;
  readonly body: string;
  readonly actor: CouncilActor;
}

/** Écrit l'appréciation GÉNÉRALE du conseil (`author_role = COUNCIL`, sans matière) ; modifiable jusqu'à la clôture ; auditée. */
export async function writeCouncilAppreciation(deps: ResultsDeps, ctx: RequestContext, input: WriteCouncilAppreciationInput): Promise<Result<AppreciationRecord, AppError>> {
  const actorCheck = checkActor(input.actor);
  if (!actorCheck.ok) return actorCheck;
  const body = input.body.trim();
  if (body.length === 0 || body.length > 1000) return err(validation(ResultsCode.INVALID_INPUT, "L'appréciation doit faire entre 1 et 1000 caractères.", "body"));
  return inTx(deps, ctx, async (tx) => {
    const loaded = await loadOpenState(tx, input.stateId);
    if (!loaded.ok) return loaded;
    const rec = await guarded(() =>
      upsertAppreciation(tx, { id: deps.newId(), tenantId: ctx.tenantId, stateId: loaded.value.id, enrollmentId: input.enrollmentId, curriculumNodeId: null, authorStaffId: input.authorStaffId, authorRole: "COUNCIL", body, now: deps.clock.now() }),
    );
    const events = new EventBuffer(deps, ctx);
    // jamais le texte de l'appréciation dans l'audit : seulement qui, quoi, quel acte
    events.audit({
      action: "results.appreciation.written_by_council",
      entity: "appreciation",
      entityId: rec.id,
      after: { enrollmentId: rec.enrollmentId, authorRole: rec.authorRole, length: body.length },
      metadata: { source: input.actor.source, councilRef: input.actor.councilRef, stateId: rec.stateId },
      severity: "info",
    });
    await events.flush(tx);
    return ok(rec);
  });
}
