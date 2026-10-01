/**
 * Surcharges justifiées, décisions, délibérations, appréciations, réglages.
 *
 *  - Une surcharge est la SEULE voie manuelle (jamais de saisie de moyenne) : cible précise (inscription × période × nœud ×
 *    niveau × clé de règle), valeur d'origine, valeur imposée, justification ≥ 20 caractères, demandeur, approbateur ≠
 *    demandeur, dates. Approuvée, elle est INJECTÉE dans le contexte de l'étape (les étapes en aval utilisent la valeur
 *    surchargée), marquée dans la trace ; elle ne modifie JAMAIS les notes. Auditée en avertissement.
 *  - Une décision confirmée différente de la proposition de la règle exige une justification (≥ 20) et le droit de
 *    confirmer ; la proposition est conservée avec la décision finale (R-RES-05). La logique s'appuie sur les CODES.
 *  - Appréciations et délibérations : modifiables jusqu'à la clôture (R-RES-09).
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import { isUniqueViolation } from "@ecoledigitale/database";
import { getContract } from "../../rules";
import { findOverridable, outcomeOf, DECISION_RULES } from "../domain/catalog";
import { ResultsCode, conflict, forbidden, notFound, validation } from "../domain/errors";
import { ResultsEvents } from "../domain/events";
import type { AppreciationRecord, DecisionRecord, DeliberationRecord, OverrideRecord, PeriodState, ResultsSettings } from "../domain/records";
import type { Level, OverrideKind } from "../domain/types";
import { guarded } from "../infrastructure/db-errors";
import {
  confirmDecision,
  decideOverride,
  getDecision,
  getDeliberation,
  getOverride,
  insertDeliberation,
  insertOverride,
  listAppreciations,
  listDecisions,
  listDeliberations,
  listOverrides,
  revokeOverride,
  updateDeliberation,
  upsertAppreciation,
} from "../infrastructure/governance-repository";
import { listCurrentHeaders, listLines } from "../infrastructure/results-repository";
import { getSettingsRow, getStateById, upsertSettings } from "../infrastructure/states-repository";
import { EventBuffer, inTx, type ResultsCaps, type ResultsDeps } from "./deps";
import { emitConfirmed } from "./lifecycle";
import { requestRecompute } from "./recompute";

const deny = (message: string): Result<never, AppError> => err(forbidden(ResultsCode.FORBIDDEN, message));
const decimalRe = /^\d{1,6}(\.\d{1,6})?$/;

async function loadState(tx: Parameters<typeof getStateById>[0], stateId: string, lock?: "share" | "update"): Promise<Result<PeriodState, AppError>> {
  const s = await getStateById(tx, stateId, lock);
  return s ? ok(s) : err(notFound(ResultsCode.STATE_NOT_FOUND, "État de la période", stateId));
}

// ---------------------------------------------------------------------------------------------------------------------
// Surcharges
// ---------------------------------------------------------------------------------------------------------------------

export interface RequestOverrideInput {
  stateId: string;
  enrollmentId: string;
  level: Level;
  curriculumNodeId?: string | null | undefined;
  ruleKey: string;
  kind: OverrideKind;
  /** Valeur décimale exacte imposée (kind VALUE). */
  value?: string | undefined;
  /** Validation imposée (kind VALIDATION). */
  flag?: boolean | undefined;
  justification: string;
  caps?: ResultsCaps | undefined;
}

/** Valeur actuellement calculée de la cible (texte), pour la conserver comme valeur d'origine. */
async function originalOf(tx: Parameters<typeof getStateById>[0], state: PeriodState, input: RequestOverrideInput): Promise<string | null> {
  const header = (await listCurrentHeaders(tx, state.id)).find((h) => h.enrollmentId === input.enrollmentId);
  if (!header) return null;
  const line = (await listLines(tx, header.id)).find((l) => l.level === input.level && (l.curriculumNodeId ?? null) === (input.curriculumNodeId ?? null));
  if (!line) return null;
  return input.kind === "VALUE" ? line.value : line.validated === null ? null : String(line.validated);
}

export async function requestOverride(deps: ResultsDeps, ctx: RequestContext, input: RequestOverrideInput): Promise<Result<OverrideRecord, AppError>> {
  if (!input.caps?.overrideRequest) return deny("Vous n'avez pas le droit de demander une surcharge.");
  if (!ctx.userId) return deny("Un utilisateur authentifié est requis.");
  if (input.justification.trim().length < 20) return err(validation(ResultsCode.JUSTIFICATION_REQUIRED, "La justification d'une surcharge est obligatoire (20 caractères au moins).", "justification"));
  return inTx(deps, ctx, async (tx) => {
    const loaded = await loadState(tx, input.stateId, "share");
    if (!loaded.ok) return loaded;
    const state = loaded.value;
    if (state.status === "CLOSED") return err(conflict(ResultsCode.STATE_CLOSED, "La période est clôturée : rouvrez-la pour surcharger un résultat.", { stateId: state.id }));
    if (!findOverridable(state.contractId, input.ruleKey, input.level, input.kind)) {
      return err(validation(ResultsCode.OVERRIDE_NOT_ALLOWED, `Aucune surcharge ${input.kind} n'est permise sur l'étape « ${input.ruleKey} » au niveau ${input.level}.`, "ruleKey"));
    }
    if (input.kind === "VALUE" && (input.value === undefined || !decimalRe.test(input.value))) return err(validation(ResultsCode.OVERRIDE_INVALID, "Une surcharge de valeur exige un décimal exact positif.", "value"));
    if (input.kind === "VALIDATION" && typeof input.flag !== "boolean") return err(validation(ResultsCode.OVERRIDE_INVALID, "Une surcharge de validation exige un booléen.", "flag"));
    const needsNode = input.level !== "PERIOD" && input.level !== "YEAR";
    if (needsNode && !input.curriculumNodeId) return err(validation(ResultsCode.OVERRIDE_INVALID, "Indiquez le nœud du curriculum visé par la surcharge.", "curriculumNodeId"));
    if (!needsNode && input.curriculumNodeId) return err(validation(ResultsCode.OVERRIDE_INVALID, "Une surcharge de niveau période / année ne vise aucun nœud.", "curriculumNodeId"));
    const member = (await deps.ports.roster.listEnrollments(ctx, state.classroomId)).find((r) => r.enrollmentId === input.enrollmentId);
    if (!member) return err(validation(ResultsCode.OVERRIDE_INVALID, "Cette inscription n'appartient pas à la classe.", "enrollmentId"));

    const original = await originalOf(tx, state, input);
    const events = new EventBuffer(deps, ctx);
    let record: OverrideRecord;
    try {
      record = await guarded(() =>
        tx.transaction(async (sp) =>
          insertOverride(sp, {
            id: deps.newId(),
            tenantId: ctx.tenantId,
            stateId: state.id,
            enrollmentId: input.enrollmentId,
            level: input.level,
            curriculumNodeId: input.curriculumNodeId ?? null,
            ruleKey: input.ruleKey,
            kind: input.kind,
            originalValue: original,
            overrideValue: input.kind === "VALUE" ? (input.value as string) : null,
            overrideFlag: input.kind === "VALIDATION" ? (input.flag as boolean) : null,
            justification: input.justification.trim(),
            requestedBy: ctx.userId as string,
            requestedByName: await deps.ports.names.nameOf(ctx, ctx.userId as string),
            now: deps.clock.now(),
          }),
        ),
      );
    } catch (e) {
      if (isUniqueViolation(e)) return err(conflict(ResultsCode.OVERRIDE_DUPLICATE, "Une surcharge est déjà en cours pour cette cible : traitez-la ou révoquez-la d'abord.", {}));
      throw e;
    }
    events.add(ResultsEvents.OVERRIDE_REQUESTED, { v: 1, overrideId: record.id, enrollmentId: record.enrollmentId, periodId: state.academicPeriodId, stateId: state.id }, { type: "override", id: record.id });
    events.audit({ action: "results.override.requested", entity: "override", entityId: record.id, after: { level: record.level, ruleKey: record.ruleKey, kind: record.kind, original: record.originalValue, imposed: record.overrideValue ?? record.overrideFlag }, reason: record.justification, severity: "warning" });
    await events.flush(tx);
    return ok(record);
  });
}

export async function approveOverride(deps: ResultsDeps, ctx: RequestContext, input: { overrideId: string; comment?: string | undefined; caps?: ResultsCaps | undefined }): Promise<Result<OverrideRecord, AppError>> {
  if (!input.caps?.overrideApprove) return deny("Vous n'avez pas le droit d'approuver une surcharge.");
  if (!ctx.userId) return deny("Un utilisateur authentifié est requis.");
  return inTx(deps, ctx, async (tx) => {
    const o = await getOverride(tx, input.overrideId, true);
    if (!o) return err(notFound(ResultsCode.OVERRIDE_NOT_FOUND, "Surcharge", input.overrideId));
    if (o.status !== "REQUESTED") return err(conflict(ResultsCode.OVERRIDE_TRANSITION, `Cette surcharge est déjà « ${o.status} ».`, { status: o.status }));
    const settings = await getSettingsRow(tx);
    const same = o.requestedBy === ctx.userId;
    if (same && settings.requireSeparateApprover) return err(conflict(ResultsCode.FOUR_EYES, "Le demandeur d'une surcharge ne peut pas l'approuver lui-même.", {}));
    const state = await loadState(tx, o.stateId, "share");
    if (!state.ok) return state;
    if (state.value.status === "CLOSED") return err(conflict(ResultsCode.STATE_CLOSED, "La période est clôturée.", {}));
    const decided = await guarded(async () => decideOverride(tx, { id: o.id, status: "APPROVED", by: ctx.userId as string, byName: await deps.ports.names.nameOf(ctx, ctx.userId as string), at: deps.clock.now(), comment: input.comment?.trim() || null, fourEyesWaived: same }));
    if (!decided) return err(conflict(ResultsCode.OVERRIDE_TRANSITION, "La surcharge a été traitée entre-temps.", {}));
    const events = new EventBuffer(deps, ctx);
    events.add(ResultsEvents.OVERRIDE_APPROVED, { v: 1, overrideId: decided.id, enrollmentId: decided.enrollmentId, periodId: state.value.academicPeriodId, stateId: state.value.id }, { type: "override", id: decided.id });
    events.audit({ action: "results.override.approved", entity: "override", entityId: decided.id, after: { ruleKey: decided.ruleKey, level: decided.level, original: decided.originalValue, imposed: decided.overrideValue ?? decided.overrideFlag, waived: same }, reason: decided.justification, severity: "warning" });
    await events.flush(tx);
    // L'effet est rejoué par le recalcul qui suit.
    await requestRecompute(deps, ctx, { classroomId: state.value.classroomId, academicPeriodId: state.value.academicPeriodId as string, enrollmentIds: [decided.enrollmentId], cause: { event: ResultsEvents.OVERRIDE_APPROVED, id: decided.id }, tx });
    return ok(decided);
  });
}

export async function rejectOverride(deps: ResultsDeps, ctx: RequestContext, input: { overrideId: string; comment: string; caps?: ResultsCaps | undefined }): Promise<Result<OverrideRecord, AppError>> {
  if (!input.caps?.overrideApprove) return deny("Vous n'avez pas le droit de rejeter une surcharge.");
  if (!ctx.userId) return deny("Un utilisateur authentifié est requis.");
  if (input.comment.trim().length < 5) return err(validation(ResultsCode.JUSTIFICATION_REQUIRED, "Le motif du rejet est obligatoire (5 caractères au moins).", "comment"));
  return inTx(deps, ctx, async (tx) => {
    const o = await getOverride(tx, input.overrideId, true);
    if (!o) return err(notFound(ResultsCode.OVERRIDE_NOT_FOUND, "Surcharge", input.overrideId));
    const decided = await guarded(async () => decideOverride(tx, { id: o.id, status: "REJECTED", by: ctx.userId as string, byName: await deps.ports.names.nameOf(ctx, ctx.userId as string), at: deps.clock.now(), comment: input.comment.trim(), fourEyesWaived: o.requestedBy === ctx.userId }));
    if (!decided) return err(conflict(ResultsCode.OVERRIDE_TRANSITION, `Cette surcharge est déjà « ${o.status} ».`, { status: o.status }));
    const events = new EventBuffer(deps, ctx);
    events.audit({ action: "results.override.rejected", entity: "override", entityId: decided.id, reason: input.comment.trim(), severity: "notice" });
    await events.flush(tx);
    return ok(decided);
  });
}

export async function revokeOverrideUseCase(deps: ResultsDeps, ctx: RequestContext, input: { overrideId: string; reason: string; caps?: ResultsCaps | undefined }): Promise<Result<OverrideRecord, AppError>> {
  if (!input.caps?.overrideApprove) return deny("Vous n'avez pas le droit de révoquer une surcharge.");
  if (!ctx.userId) return deny("Un utilisateur authentifié est requis.");
  if (input.reason.trim().length < 10) return err(validation(ResultsCode.JUSTIFICATION_REQUIRED, "Le motif de révocation est obligatoire (10 caractères au moins).", "reason"));
  return inTx(deps, ctx, async (tx) => {
    const o = await getOverride(tx, input.overrideId, true);
    if (!o) return err(notFound(ResultsCode.OVERRIDE_NOT_FOUND, "Surcharge", input.overrideId));
    const state = await loadState(tx, o.stateId, "share");
    if (!state.ok) return state;
    if (state.value.status === "CLOSED") return err(conflict(ResultsCode.STATE_CLOSED, "La période est clôturée : rouvrez-la pour révoquer une surcharge.", {}));
    const was = o.status;
    const revoked = await guarded(async () => revokeOverride(tx, { id: o.id, by: ctx.userId as string, byName: await deps.ports.names.nameOf(ctx, ctx.userId as string), at: deps.clock.now(), reason: input.reason.trim() }));
    if (!revoked) return err(conflict(ResultsCode.OVERRIDE_TRANSITION, `Cette surcharge est déjà « ${o.status} ».`, { status: o.status }));
    const events = new EventBuffer(deps, ctx);
    events.add(ResultsEvents.OVERRIDE_REVOKED, { v: 1, overrideId: revoked.id, enrollmentId: revoked.enrollmentId, periodId: state.value.academicPeriodId, stateId: state.value.id }, { type: "override", id: revoked.id });
    events.audit({ action: "results.override.revoked", entity: "override", entityId: revoked.id, reason: input.reason.trim(), severity: "warning" });
    await events.flush(tx);
    // Le recalcul qui suit retire l'effet.
    if (was === "APPROVED") await requestRecompute(deps, ctx, { classroomId: state.value.classroomId, academicPeriodId: state.value.academicPeriodId as string, enrollmentIds: [revoked.enrollmentId], cause: { event: ResultsEvents.OVERRIDE_REVOKED, id: revoked.id }, tx });
    return ok(revoked);
  });
}

export async function listOverridesView(deps: ResultsDeps, ctx: RequestContext, input: { stateId?: string | undefined; enrollmentId?: string | undefined; status?: string | undefined; caps?: ResultsCaps | undefined }): Promise<Result<OverrideRecord[], AppError>> {
  if (!input.caps?.overrideRequest && !input.caps?.overrideApprove) return deny("Vous n'avez pas le droit de consulter les surcharges.");
  return inTx(deps, ctx, async (tx) => ok(await listOverrides(tx, input)), { readOnly: true });
}

// ---------------------------------------------------------------------------------------------------------------------
// Décisions
// ---------------------------------------------------------------------------------------------------------------------

export async function listDecisionsView(deps: ResultsDeps, ctx: RequestContext, input: { stateId: string; enrollmentId?: string | undefined; caps?: ResultsCaps | undefined }): Promise<Result<DecisionRecord[], AppError>> {
  if (!input.caps?.decisionRecord && !input.caps?.decisionApprove && !input.caps?.read) return deny("Vous n'avez pas le droit de consulter les décisions.");
  return inTx(deps, ctx, async (tx) => ok(await listDecisions(tx, { stateId: input.stateId, enrollmentId: input.enrollmentId })), { readOnly: true });
}

export interface ConfirmDecisionInput {
  decisionId: string;
  /** Code final ; absent ⇒ la proposition de la règle est confirmée telle quelle. */
  finalCode?: string | undefined;
  justification?: string | undefined;
  deliberationId?: string | undefined;
  caps?: ResultsCaps | undefined;
}

export async function confirmDecisionUseCase(deps: ResultsDeps, ctx: RequestContext, input: ConfirmDecisionInput): Promise<Result<DecisionRecord, AppError>> {
  if (!ctx.userId) return deny("Un utilisateur authentifié est requis.");
  return inTx(deps, ctx, async (tx) => {
    const d = await getDecision(tx, input.decisionId, true);
    if (!d) return err(notFound(ResultsCode.DECISION_NOT_FOUND, "Décision", input.decisionId));
    if (d.status === "PUBLISHED" || d.status === "WITHDRAWN") return err(conflict(ResultsCode.DECISION_TRANSITION, `Cette décision est « ${d.status} » : elle ne change plus.`, { status: d.status }));
    const stateLoaded = await loadState(tx, d.stateId, "share");
    if (!stateLoaded.ok) return stateLoaded;
    const state = stateLoaded.value;
    if (state.status === "CLOSED") return err(conflict(ResultsCode.STATE_CLOSED, "La période est clôturée : les décisions sont figées.", {}));
    const finalCode = input.finalCode ?? d.proposedCode;
    if (!finalCode) return err(validation(ResultsCode.INVALID_INPUT, "Aucune proposition à confirmer : indiquez le code final.", "finalCode"));
    const changed = finalCode !== d.proposedCode;
    if (changed) {
      if (!input.caps?.decisionApprove) return deny("Modifier la décision proposée par la règle exige le droit de confirmer les décisions.");
      if ((input.justification?.trim().length ?? 0) < 20) return err(validation(ResultsCode.JUSTIFICATION_REQUIRED, "Une décision différente de la proposition de la règle exige une justification (20 caractères au moins).", "justification"));
      const ruleKey = DECISION_RULES[state.contractId]?.find((r) => r.kind === d.kind)?.ruleKey;
      const allowed = ruleKey ? getContract(state.contractId)?.rules.find((r) => r.key === ruleKey)?.outputCodes : undefined;
      if (allowed && allowed.length > 0 && !allowed.includes(finalCode)) {
        return err(validation(ResultsCode.INVALID_INPUT, `« ${finalCode} » n'est pas un code permis pour cette décision (${allowed.join(", ")}).`, "finalCode"));
      }
    } else if (!input.caps?.decisionRecord && !input.caps?.decisionApprove) {
      return deny("Vous n'avez pas le droit de confirmer une décision.");
    }
    if (input.deliberationId) {
      const delib = await getDeliberation(tx, input.deliberationId);
      if (!delib || delib.stateId !== d.stateId) return err(notFound(ResultsCode.DELIBERATION_NOT_FOUND, "Délibération", input.deliberationId));
    }
    const actorName = await deps.ports.names.nameOf(ctx, ctx.userId as string);
    const done = await guarded(() =>
      confirmDecision(tx, { id: d.id, finalCode, finalOutcome: outcomeOf(finalCode), deliberationId: input.deliberationId ?? null, justification: changed ? (input.justification as string).trim() : null, by: ctx.userId as string, byName: actorName, at: deps.clock.now() }),
    );
    if (!done) return err(conflict(ResultsCode.DECISION_TRANSITION, "La décision a été traitée entre-temps.", {}));
    const events = new EventBuffer(deps, ctx);
    emitConfirmed(events, state, done);
    events.audit({
      action: "results.decision.confirmed",
      entity: "decision",
      entityId: done.id,
      before: { proposed: done.proposedCode },
      after: { final: done.finalCode, outcome: done.finalOutcome },
      reason: changed ? done.justification : null,
      severity: changed ? "warning" : "notice",
    });
    await events.flush(tx);
    return ok(done);
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Délibérations
// ---------------------------------------------------------------------------------------------------------------------

export interface DeliberationInput {
  stateId: string;
  kind: "COUNCIL" | "JURY";
  heldOn?: string | undefined;
  participants?: ReadonlyArray<{ staffId: string; role: string }> | undefined;
  caps?: ResultsCaps | undefined;
}

export async function createDeliberation(deps: ResultsDeps, ctx: RequestContext, input: DeliberationInput): Promise<Result<DeliberationRecord, AppError>> {
  if (!input.caps?.decisionRecord) return deny("Vous n'avez pas le droit d'enregistrer une délibération.");
  if (!ctx.userId) return deny("Un utilisateur authentifié est requis.");
  return inTx(deps, ctx, async (tx) => {
    const state = await loadState(tx, input.stateId, "share");
    if (!state.ok) return state;
    if (state.value.status === "CLOSED") return err(conflict(ResultsCode.STATE_CLOSED, "La période est clôturée.", {}));
    const rec = await guarded(() =>
      insertDeliberation(tx, { id: deps.newId(), tenantId: ctx.tenantId, classroomId: state.value.classroomId, stateId: state.value.id, kind: input.kind, heldOn: input.heldOn ?? null, status: "PLANNED", participants: input.participants ?? [], createdBy: ctx.userId as string, now: deps.clock.now() }),
    );
    const events = new EventBuffer(deps, ctx);
    events.audit({ action: "results.deliberation.created", entity: "deliberation", entityId: rec.id, after: { kind: rec.kind, stateId: rec.stateId }, severity: "info" });
    await events.flush(tx);
    return ok(rec);
  });
}

export async function updateDeliberationUseCase(
  deps: ResultsDeps,
  ctx: RequestContext,
  input: { deliberationId: string; status?: "HELD" | "SIGNED" | "CANCELLED" | undefined; heldOn?: string | undefined; participants?: ReadonlyArray<{ staffId: string; role: string }> | undefined; minutesObjectKey?: string | undefined; caps?: ResultsCaps | undefined },
): Promise<Result<DeliberationRecord, AppError>> {
  if (!input.caps?.decisionRecord) return deny("Vous n'avez pas le droit de modifier une délibération.");
  return inTx(deps, ctx, async (tx) => {
    const d = await getDeliberation(tx, input.deliberationId, true);
    if (!d) return err(notFound(ResultsCode.DELIBERATION_NOT_FOUND, "Délibération", input.deliberationId));
    const next = input.status;
    const legal = !next || (d.status === "PLANNED" && (next === "HELD" || next === "CANCELLED")) || (d.status === "HELD" && (next === "SIGNED" || next === "CANCELLED"));
    if (!legal) return err(conflict(ResultsCode.INVALID_STATE_TRANSITION, `Une délibération « ${d.status} » ne peut pas passer à « ${next} ».`, { from: d.status, to: next }));
    if ((next === "HELD" || next === "SIGNED") && !(input.heldOn ?? d.heldOn)) return err(validation(ResultsCode.INVALID_INPUT, "La date réelle de la séance est obligatoire pour une délibération tenue.", "heldOn"));
    const updated = await guarded(() => updateDeliberation(tx, d.id, { status: next, heldOn: input.heldOn, participants: input.participants, minutesObjectKey: input.minutesObjectKey }, deps.clock.now()));
    if (!updated) return err(notFound(ResultsCode.DELIBERATION_NOT_FOUND, "Délibération", input.deliberationId));
    const events = new EventBuffer(deps, ctx);
    events.audit({ action: `results.deliberation.${(next ?? "updated").toLowerCase()}`, entity: "deliberation", entityId: d.id, before: { status: d.status }, after: { status: updated.status, heldOn: updated.heldOn }, severity: "notice" });
    await events.flush(tx);
    return ok(updated);
  });
}

export async function listDeliberationsView(deps: ResultsDeps, ctx: RequestContext, input: { stateId: string; caps?: ResultsCaps | undefined }): Promise<Result<DeliberationRecord[], AppError>> {
  if (!input.caps?.decisionRecord && !input.caps?.read) return deny("Vous n'avez pas le droit de consulter les délibérations.");
  return inTx(deps, ctx, async (tx) => ok(await listDeliberations(tx, input.stateId)), { readOnly: true });
}

// ---------------------------------------------------------------------------------------------------------------------
// Appréciations
// ---------------------------------------------------------------------------------------------------------------------

export async function writeAppreciation(
  deps: ResultsDeps,
  ctx: RequestContext,
  input: { stateId: string; enrollmentId: string; curriculumNodeId?: string | null | undefined; authorStaffId: string; authorRole: "TEACHER" | "COUNCIL" | "DIRECTOR"; body: string; caps?: ResultsCaps | undefined },
): Promise<Result<AppreciationRecord, AppError>> {
  if (!input.caps?.appreciationWrite) return deny("Vous n'avez pas le droit de rédiger une appréciation.");
  if (input.body.trim().length === 0) return err(validation(ResultsCode.INVALID_INPUT, "L'appréciation est vide.", "body"));
  if (input.authorRole === "TEACHER" && !input.curriculumNodeId) return err(validation(ResultsCode.INVALID_INPUT, "L'appréciation d'un enseignant porte sur une matière.", "curriculumNodeId"));
  return inTx(deps, ctx, async (tx) => {
    const state = await loadState(tx, input.stateId, "share");
    if (!state.ok) return state;
    if (state.value.status === "CLOSED") return err(conflict(ResultsCode.STATE_CLOSED, "La période est clôturée : les appréciations sont figées.", {}));
    const rec = await guarded(() =>
      upsertAppreciation(tx, { id: deps.newId(), tenantId: ctx.tenantId, stateId: state.value.id, enrollmentId: input.enrollmentId, curriculumNodeId: input.curriculumNodeId ?? null, authorStaffId: input.authorStaffId, authorRole: input.authorRole, body: input.body.trim(), now: deps.clock.now() }),
    );
    return ok(rec);
  });
}

export async function listAppreciationsView(deps: ResultsDeps, ctx: RequestContext, input: { stateId: string; enrollmentId?: string | undefined; caps?: ResultsCaps | undefined }): Promise<Result<AppreciationRecord[], AppError>> {
  if (!input.caps?.appreciationWrite && !input.caps?.read) return deny("Vous n'avez pas le droit de consulter les appréciations.");
  return inTx(deps, ctx, async (tx) => ok(await listAppreciations(tx, input.stateId, input.enrollmentId)), { readOnly: true });
}

// ---------------------------------------------------------------------------------------------------------------------
// Réglages
// ---------------------------------------------------------------------------------------------------------------------

export async function getResultsSettings(deps: ResultsDeps, ctx: RequestContext): Promise<Result<ResultsSettings, AppError>> {
  return inTx(deps, ctx, async (tx) => ok(await getSettingsRow(tx)), { readOnly: true });
}

export async function updateResultsSettings(
  deps: ResultsDeps,
  ctx: RequestContext,
  input: { requireDeliberation?: boolean | undefined; requireSeparateApprover?: boolean | undefined; recomputeDelaySeconds?: number | undefined },
): Promise<Result<ResultsSettings, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const before = await getSettingsRow(tx);
    const after = await upsertSettings(tx, ctx.tenantId, input, ctx.userId, deps.clock.now());
    const events = new EventBuffer(deps, ctx);
    const relaxed = (before.requireDeliberation && !after.requireDeliberation) || (before.requireSeparateApprover && !after.requireSeparateApprover);
    events.audit({ action: "results.settings.updated", entity: "results_settings", entityId: ctx.tenantId, before, after, severity: relaxed ? "warning" : "notice" });
    await events.flush(tx);
    return ok(after);
  });
}
