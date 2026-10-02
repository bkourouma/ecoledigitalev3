/**
 * Effets des décisions (spec 006 US6) : propagation IDEMPOTENTE vers `results`, `academic`, orientation, `people`.
 *
 *  - Les effets naissent à l'état configuré (`effects_trigger` : `SIGNED` par défaut, ou `CLOSED`) — avant, la base refuse.
 *  - Unique par (décision ou proposition, nature) tant qu'il est vivant : un rejeu ne crée jamais de doublon.
 *  - L'EXCLUSION n'est JAMAIS appliquée par un job : l'effet `STUDENT_STATUS_REQUEST` naît `AWAITING_HUMAN` et ne passe `APPLIED` que par
 *    l'acte d'un utilisateur habilité (`applied_by` posé par la base) qui appelle `people.changeStudentStatus`.
 *  - Un échec (port indisponible, refus de `results`) laisse l'effet repris plus tard : port non branché ⇒ l'effet reste `PENDING`
 *    (jamais appliqué à moitié) ; autre échec ⇒ `FAILED` avec diagnostic, tentatives comptées, relance manuelle ou par le job.
 *  - Annulation : `RESULTS_DECISION` et `RESULTS_DISTINCTION` s'annulent par la RÉOUVERTURE de la période de résultats (`results` n'offre
 *    aucune API de retrait) : l'abonné `councils.revert-on-results-reopened` l'enregistre et signale « conseil à revoir ».
 * Aucune règle de décision ici : les codes viennent des types de décision (données) et sont validés par `results`.
 */
import { createRequestContext, err, isAppError, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { Tx } from "@ecoledigitale/database";
import type { CouncilsEffectDto, CouncilsEffectsDto } from "@ecoledigitale/contracts/src/v2/councils";
import { effectKindOfProposal, effectKindsOfDecision, initialEffectStatus, REVERTED_BY_RESULTS_REOPEN, type EffectKind } from "../domain/effects";
import { CouncilsCode, conflict, forbidden, invalid, notFound } from "../domain/errors";
import { CouncilsEvents } from "../domain/events";
import { canTransition, EFFECT_TRANSITIONS } from "../domain/machines";
import * as councilsRepo from "../infrastructure/councils-repository";
import * as repo from "../infrastructure/effects-repository";
import * as minutesRepo from "../infrastructure/minutes-repository";
import * as orientationRepo from "../infrastructure/orientation-repository";
import * as reference from "../infrastructure/reference-repository";
import type { CouncilRow, DecisionRow, DecisionTypeRow, EffectRow, ProposalRow } from "../infrastructure/rows";
import { EventBuffer, inTx, requireHuman, type CallerCaps, type CouncilsDeps } from "./deps";
import { assertMayView, clampPage, councilRefOf, decisionRefOf, loadCouncil, proposalRefOf } from "./support";
import { effectDto } from "./views";

const councilPayload = (c: CouncilRow): { v: 1 } & Record<string, unknown> => ({ v: 1, councilId: c.id, institutionId: c.institutionId, classroomId: c.classroomId, academicYearId: c.academicYearId, academicPeriodId: c.academicPeriodId, scope: c.scope, status: c.status });

const effectEventFor = (status: string): string | null =>
  status === "APPLIED" ? CouncilsEvents.EFFECT_APPLIED : status === "FAILED" ? CouncilsEvents.EFFECT_FAILED : status === "REVERTED" ? CouncilsEvents.EFFECT_REVERTED : status === "AWAITING_HUMAN" ? CouncilsEvents.EFFECT_AWAITING_HUMAN : null;

function emitEffect(events: EventBuffer, e: EffectRow, status: string): void {
  const type = effectEventFor(status);
  if (!type) return;
  events.add(type, { v: 1, effectId: e.id, councilId: e.councilId, kind: e.effectKind, decisionId: e.decisionId, proposalId: e.proposalId }, { type: "councils.effect", id: e.id });
}

// ---------------------------------------------------------------------------------------------------------------------
// Planification
// ---------------------------------------------------------------------------------------------------------------------

/** L'état courant de la séance a-t-il atteint le déclencheur des effets ? (miroir de `effects_guard`). */
export const triggerReached = (trigger: "CLOSED" | "SIGNED", status: string): boolean => (trigger === "SIGNED" ? status === "SIGNED" : status === "CLOSED" || status === "SIGNED");

/**
 * Crée les effets des décisions enregistrées et des propositions d'appréciation / de distinction ACCEPTÉES. Idempotent. Les décisions
 * retirées et les propositions non acceptées n'en produisent aucun.
 */
export async function planEffects(deps: CouncilsDeps, ctx: RequestContext, tx: Tx, events: EventBuffer, council: CouncilRow): Promise<{ created: number }> {
  const settings = await reference.getSettings(tx, council.institutionId);
  const trigger = settings?.effectsTrigger ?? "SIGNED";
  if (!triggerReached(trigger, council.status)) return { created: 0 };
  const visibility = settings?.guardianVisibility ?? "AFTER_NOTIFICATION";
  const decisions = await councilsRepo.listDecisionsOfCouncil(tx, council.id, { recordedOnly: true });
  const types = new Map((await reference.getDecisionTypesByIds(tx, [...new Set(decisions.map((d) => d.decisionTypeId))])).map((t) => [t.id, t]));
  let created = 0;
  for (const d of decisions) {
    const t = types.get(d.decisionTypeId);
    if (!t) continue;
    for (const kind of effectKindsOfDecision({ family: t.family, resultsDecisionKind: t.resultsDecisionKind, resultsFinalCode: t.resultsFinalCode, academicOutcomeCode: t.academicOutcomeCode, needsHumanApplication: t.needsHumanApplication, hasTarget: d.targetGradeLevelId !== null })) {
      if (kind === "NOTIFY_GUARDIANS" && visibility === "NEVER") continue;
      const status = initialEffectStatus(kind, t.needsHumanApplication);
      const effectId = deps.newId();
      if (await repo.insertEffect(tx, { id: effectId, tenantId: ctx.tenantId, councilId: council.id, decisionId: d.id, proposalId: null, kind, status })) {
        created += 1;
        if (status === "AWAITING_HUMAN") events.add(CouncilsEvents.EFFECT_AWAITING_HUMAN, { v: 1, effectId, councilId: council.id, kind, decisionId: d.id, proposalId: null }, { type: "councils.effect", id: effectId });
      }
    }
  }
  const proposals = (await councilsRepo.listProposalsOfCouncil(tx, council.id)).filter((p) => p.status === "ACCEPTED" || p.status === "MODIFIED");
  for (const p of proposals) {
    const kind = effectKindOfProposal(p.kind);
    if (!kind) continue;
    if (await repo.insertEffect(tx, { id: deps.newId(), tenantId: ctx.tenantId, councilId: council.id, decisionId: null, proposalId: p.id, kind, status: "PENDING" })) created += 1;
  }
  if (created > 0) events.audit({ action: "councils.effects.planned", resourceType: "council", resourceId: council.id, after: { created } });
  return { created };
}

// ---------------------------------------------------------------------------------------------------------------------
// Application
// ---------------------------------------------------------------------------------------------------------------------

interface Applied {
  readonly externalRef: string | null;
}

class EffectFailure extends Error {
  constructor(
    readonly error: AppError,
    readonly retryable: boolean,
  ) {
    super(error.message);
  }
}

const fail = (code: string, message: string): EffectFailure => new EffectFailure(invalid(code, message), true);

async function authorStaffOf(tx: Tx, councilId: string): Promise<string | null> {
  const participants = await councilsRepo.listParticipants(tx, councilId);
  const order = (p: { councilFunction: string | null }): number => (p.councilFunction === "PRESIDENT" ? 0 : p.councilFunction === "SECRETARY" ? 1 : 2);
  return [...participants].filter((p) => p.staffId !== null && p.presence === "PRESENT").sort((a, b) => order(a) - order(b))[0]?.staffId ?? null;
}

/** Exécute UN effet (ports de lecture/écriture, tables du module). Lève `EffectFailure` ; ne touche pas au statut de l'effet. */
async function executeEffect(deps: CouncilsDeps, ctx: RequestContext, tx: Tx, council: CouncilRow, effect: EffectRow, human: boolean, sub: EventBuffer): Promise<Applied> {
  const decision = effect.decisionId ? await councilsRepo.getDecision(tx, effect.decisionId) : null;
  const proposal = effect.proposalId ? await councilsRepo.getProposal(tx, effect.proposalId) : null;
  const type = decision ? await reference.getDecisionType(tx, decision.decisionTypeId) : null;
  const stateId = council.resultsStateId;
  switch (effect.effectKind) {
    case "RESULTS_DECISION": {
      if (!decision || !type || type.resultsFinalCode === null) throw fail(CouncilsCode.EFFECT_NOT_APPLICABLE, "Le type de décision ne porte aucun code final de résultats.");
      if (!stateId) throw fail(CouncilsCode.RESULTS_UNAVAILABLE, "La séance n'est pas rattachée à un état de résultats.");
      const r = await deps.ports.resultsWrite.publishYearDecision(ctx, { stateId, enrollmentId: decision.enrollmentId, finalCode: type.resultsFinalCode, deliberationId: council.resultsDeliberationId, justification: decision.justification, councilRef: decisionRefOf(decision.id) });
      return { externalRef: r.decisionId };
    }
    case "ENROLLMENT_OUTCOME": {
      if (!decision || !type || type.academicOutcomeCode === null) throw fail(CouncilsCode.EFFECT_NOT_APPLICABLE, "Le type de décision ne porte aucune issue d'inscription.");
      await deps.ports.outcomes.recordOutcome(ctx, { enrollmentId: decision.enrollmentId, outcomeCode: type.academicOutcomeCode, targetProgramId: decision.targetProgramId ?? undefined, targetGradeLevelId: decision.targetGradeLevelId ?? undefined, decisionRef: decision.id });
      return { externalRef: null };
    }
    case "ORIENTATION_FILE": {
      if (!decision) throw fail(CouncilsCode.EFFECT_NOT_APPLICABLE, "Décision introuvable.");
      let file = await orientationRepo.getFileByEnrollment(tx, decision.enrollmentId);
      if (!file) {
        const enrollment = await deps.ports.academic.getEnrollment(ctx, decision.enrollmentId);
        if (!enrollment || !enrollment.programId || !enrollment.gradeLevelId) throw fail(CouncilsCode.ENROLLMENT_NOT_FOUND, "L'inscription ne porte pas de programme ou de niveau : dossier d'orientation impossible.");
        const id = deps.newId();
        await orientationRepo.insertFile(tx, { id, tenantId: ctx.tenantId, institutionId: council.institutionId, academicYearId: council.academicYearId, enrollmentId: decision.enrollmentId, studentId: decision.studentId, currentProgramId: enrollment.programId, currentGradeLevelId: enrollment.gradeLevelId, notes: null, createdBy: decision.recordedBy });
        file = await orientationRepo.getFile(tx, id);
      }
      if (!file) throw fail(CouncilsCode.NOT_FOUND, "Dossier d'orientation introuvable.");
      if (file.status === "APPLIED" || file.status === "CLOSED" || file.status === "CANCELLED") throw fail(CouncilsCode.INVALID_STATE, `Le dossier d'orientation est ${file.status} : l'avis du conseil ne peut plus y être rattaché.`);
      await orientationRepo.updateFile(tx, file.id, { status: "DECIDED", decisionId: decision.id });
      sub.add(CouncilsEvents.ORIENTATION_FILE_DECIDED, { v: 1, fileId: file.id, enrollmentId: decision.enrollmentId, studentId: decision.studentId, decisionId: decision.id }, { type: "councils.orientation_file", id: file.id });
      return { externalRef: file.id };
    }
    case "SERIES_TRANSFER": {
      if (!decision || decision.targetProgramId === null || decision.targetGradeLevelId === null) throw fail(CouncilsCode.TRANSFER_TARGET_REQUIRED, "La décision ne vise pas de série ni de niveau.");
      const existing = await orientationRepo.findLiveTransferOfDecision(tx, decision.id);
      if (existing) return { externalRef: existing.id };
      const enrollment = await deps.ports.academic.getEnrollment(ctx, decision.enrollmentId);
      if (!enrollment || !enrollment.programId || !enrollment.gradeLevelId) throw fail(CouncilsCode.ENROLLMENT_NOT_FOUND, "L'inscription ne porte pas de programme ou de niveau.");
      const path = await orientationRepo.findMatchingPath(tx, { fromProgramId: enrollment.programId, fromGradeLevelId: enrollment.gradeLevelId, toProgramId: decision.targetProgramId, toGradeLevelId: decision.targetGradeLevelId, institutionId: council.institutionId });
      if (!path) throw fail(CouncilsCode.TRANSFER_TARGET_REQUIRED, "Aucun parcours autorisé ne correspond : planifiez le transfert depuis l'orientation, avec une dérogation motivée.");
      const id = deps.newId();
      await orientationRepo.insertTransfer(tx, { id, tenantId: ctx.tenantId, institutionId: council.institutionId, enrollmentId: decision.enrollmentId, studentId: decision.studentId, fromProgramId: enrollment.programId, fromGradeLevelId: enrollment.gradeLevelId, toProgramId: decision.targetProgramId, toGradeLevelId: decision.targetGradeLevelId, effectiveKind: "NEXT_YEAR", effectiveOn: null, decidedVia: "COUNCIL", decisionId: decision.id, actReference: null, actIssuedBy: null, pathId: path.id, pathOverrideReason: null, pathOverrideBy: null, createdBy: ctx.userId as string });
      sub.add(CouncilsEvents.SERIES_TRANSFER_PLANNED, { v: 1, transferId: id, enrollmentId: decision.enrollmentId, studentId: decision.studentId, toProgramId: decision.targetProgramId, toGradeLevelId: decision.targetGradeLevelId, effectiveKind: "NEXT_YEAR" }, { type: "councils.series_transfer", id });
      return { externalRef: id };
    }
    case "STUDENT_STATUS_REQUEST": {
      if (!decision || !type) throw fail(CouncilsCode.EFFECT_NOT_APPLICABLE, "Décision introuvable.");
      if (!human) throw new EffectFailure(forbidden(CouncilsCode.HUMAN_DECISION_REQUIRED, "L'exclusion ne s'applique que par l'acte d'un utilisateur habilité."), false);
      if (type.studentStatus === null) throw fail(CouncilsCode.EFFECT_NOT_APPLICABLE, "Ce type d'exclusion n'indique pas le statut d'élève visé : complétez le type de décision.");
      await deps.ports.studentStatus.changeStudentStatus(ctx, { studentId: decision.studentId, status: type.studentStatus, reasonText: `Décision du conseil de classe du ${council.heldOn ?? ""}`.trim() });
      return { externalRef: null };
    }
    case "NOTIFY_GUARDIANS": {
      if (!decision) throw fail(CouncilsCode.EFFECT_NOT_APPLICABLE, "Décision introuvable.");
      const agenda = await councilsRepo.getAgendaItem(tx, decision.agendaItemId);
      const names = await deps.ports.family.getStudentNames(ctx, [decision.studentId]);
      // Clé d'idempotence par ÉLÈVE et séance : plusieurs décisions d'un même élève n'envoient qu'une information.
      await deps.ports.notifications.notifyGuardians(ctx, { studentId: decision.studentId, studentName: names.get(decision.studentId) ?? agenda?.studentDisplayName ?? "votre enfant", clientKey: decision.agendaItemId });
      return { externalRef: null };
    }
    case "RESULTS_APPRECIATION": {
      if (!proposal || proposal.body === null) throw fail(CouncilsCode.EFFECT_NOT_APPLICABLE, "Proposition d'appréciation introuvable.");
      if (!stateId) throw fail(CouncilsCode.RESULTS_UNAVAILABLE, "La séance n'est pas rattachée à un état de résultats.");
      const author = await authorStaffOf(tx, council.id);
      if (!author) throw fail(CouncilsCode.EFFECT_NOT_APPLICABLE, "Aucun membre du personnel présent ne peut porter l'appréciation générale.");
      const item = await councilsRepo.getAgendaItem(tx, proposal.agendaItemId);
      if (!item) throw fail(CouncilsCode.NOT_FOUND, "Élève de l'ordre du jour introuvable.");
      const r = await deps.ports.resultsWrite.writeAppreciation(ctx, { stateId, enrollmentId: item.enrollmentId, authorStaffId: author, body: proposal.body, councilRef: proposalRefOf(proposal.id) });
      return { externalRef: r.appreciationId };
    }
    case "RESULTS_DISTINCTION": {
      if (!proposal || proposal.code === null) throw fail(CouncilsCode.EFFECT_NOT_APPLICABLE, "Proposition de distinction introuvable.");
      if (!stateId) throw fail(CouncilsCode.RESULTS_UNAVAILABLE, "La séance n'est pas rattachée à un état de résultats.");
      const item = await councilsRepo.getAgendaItem(tx, proposal.agendaItemId);
      if (!item) throw fail(CouncilsCode.NOT_FOUND, "Élève de l'ordre du jour introuvable.");
      const r = await deps.ports.resultsWrite.recordDistinction(ctx, { stateId, enrollmentId: item.enrollmentId, distinctionCode: proposal.code, scope: council.scope, deliberationId: council.resultsDeliberationId, councilRef: proposalRefOf(proposal.id) });
      return { externalRef: r.decisionId };
    }
    default:
      throw fail(CouncilsCode.EFFECT_NOT_APPLICABLE, "Nature d'effet inconnue.");
  }
}

export type AttemptOutcome = { status: "APPLIED" | "FAILED" | "PENDING"; error: AppError | null };

/**
 * Tente d'appliquer un effet DANS une sous-transaction (SAVEPOINT) : l'échec d'un effet n'annule jamais les autres effets ni la
 * transaction de l'appelant. `human` : l'appelant est un utilisateur habilité (seul cas où l'exclusion s'applique).
 * Le statut est mis à jour après coup (`APPLIED`, `FAILED`, ou inchangé quand un port n'est pas branché : jamais « à moitié »).
 */
export async function attemptEffect(deps: CouncilsDeps, ctx: RequestContext, tx: Tx, ev: EventBuffer, council: CouncilRow, effect: EffectRow, human: boolean): Promise<AttemptOutcome> {
  const awaitingHuman = effect.status === "AWAITING_HUMAN";
  const sub = new EventBuffer(deps, ctx);
  try {
    const applied = await tx.transaction(async (sp) => executeEffect(deps, ctx, sp, council, effect, human, sub));
    const at = deps.clock.now();
    await repo.markEffectApplied(tx, effect.id, { externalRef: applied.externalRef, irreversible: false, at });
    ev.absorb(sub);
    emitEffect(ev, effect, "APPLIED");
    ev.audit({ action: "councils.effect.applied", resourceType: "effect", resourceId: effect.id, sensitive: effect.effectKind === "STUDENT_STATUS_REQUEST", after: { kind: effect.effectKind, councilId: council.id } });
    return { status: "APPLIED", error: null };
  } catch (e) {
    const appError: AppError | null = e instanceof EffectFailure ? e.error : isAppError(e) ? e : null;
    if (awaitingHuman) throw e instanceof EffectFailure ? e.error : e; // un acte humain qui échoue est refusé tel quel (l'effet reste en attente)
    if (appError === null) {
      // Panne inattendue d'un port (réseau, base) : l'effet est repris, avec un diagnostic sans donnée personnelle.
      const message = e instanceof Error ? e.message : String(e);
      await repo.markEffectFailed(tx, effect.id, message);
      emitEffect(ev, effect, "FAILED");
      return { status: "FAILED", error: null };
    }
    if (appError.code === CouncilsCode.PORT_UNAVAILABLE) {
      // Port non branché : l'effet reste PENDING (jamais appliqué à moitié), diagnostic conservé.
      await repo.setEffectLastError(tx, effect.id, `${appError.code}: ${appError.message}`);
      return { status: "PENDING", error: appError };
    }
    await repo.markEffectFailed(tx, effect.id, `${appError.code}: ${appError.message}`);
    emitEffect(ev, effect, "FAILED");
    return { status: "FAILED", error: appError };
  }
}

/** Applique, dans la transaction de l'appelant, les effets automatiques en attente d'une séance (jamais ceux d'un humain). */
export async function applyPendingEffects(deps: CouncilsDeps, ctx: RequestContext, tx: Tx, ev: EventBuffer, council: CouncilRow): Promise<void> {
  for (const effect of await repo.listEffectsOfCouncil(tx, council.id)) {
    if (effect.status !== "PENDING") continue;
    await attemptEffect(deps, ctx, tx, ev, council, effect, false);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Cas d'usage HTTP : file, relance, application humaine, annulation, abandon
// ---------------------------------------------------------------------------------------------------------------------

async function enrich(deps: CouncilsDeps, ctx: RequestContext, tx: Tx, rows: readonly EffectRow[]): Promise<CouncilsEffectDto[]> {
  const decisions = new Map<string, DecisionRow>();
  const proposals = new Map<string, ProposalRow>();
  for (const e of rows) {
    if (e.decisionId && !decisions.has(e.decisionId)) {
      const d = await councilsRepo.getDecision(tx, e.decisionId);
      if (d) decisions.set(d.id, d);
    }
    if (e.proposalId && !proposals.has(e.proposalId)) {
      const p = await councilsRepo.getProposal(tx, e.proposalId);
      if (p) proposals.set(p.id, p);
    }
  }
  const items = new Map<string, { studentId: string; name: string }>();
  for (const p of proposals.values()) {
    const item = await councilsRepo.getAgendaItem(tx, p.agendaItemId);
    if (item) items.set(p.id, { studentId: item.studentId, name: item.studentDisplayName });
  }
  const itemByDecision = new Map<string, string>();
  for (const d of decisions.values()) {
    const item = await councilsRepo.getAgendaItem(tx, d.agendaItemId);
    if (item) itemByDecision.set(d.id, item.studentDisplayName);
  }
  void deps;
  void ctx;
  return rows.map((e) => {
    const d = e.decisionId ? decisions.get(e.decisionId) : undefined;
    const p = e.proposalId ? items.get(e.proposalId) : undefined;
    return effectDto(e, { studentId: d?.studentId ?? p?.studentId ?? null, studentName: d ? (itemByDecision.get(d.id) ?? null) : (p?.name ?? null), decisionTypeCode: d?.decisionTypeCode ?? null });
  });
}

export async function listEffectsOfCouncilView(deps: CouncilsDeps, ctx: RequestContext, caps: CallerCaps, councilId: string): Promise<Result<CouncilsEffectsDto, AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const council = await loadCouncil(tx, councilId);
      if (!council.ok) return council;
      const may = await assertMayView(deps, ctx, caps, council.value);
      if (!may.ok) return may;
      const rows = await repo.listEffectsOfCouncil(tx, councilId);
      return ok({ items: await enrich(deps, ctx, tx, rows), total: rows.length });
    },
    { readOnly: true },
  );
}

export async function listEffectsView(deps: CouncilsDeps, ctx: RequestContext, input: { status?: string | undefined; councilId?: string | undefined; kind?: string | undefined; page: number; pageSize: number }): Promise<Result<CouncilsEffectsDto, AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const { rows, total } = await repo.listEffects(tx, input, clampPage(input.page, input.pageSize));
      return ok({ items: await enrich(deps, ctx, tx, rows), total });
    },
    { readOnly: true },
  );
}

/** Planifie les effets d'une séance dont le déclencheur est atteint (rejouable) puis applique les automatiques. */
export async function planCouncilEffects(deps: CouncilsDeps, ctx: RequestContext, councilId: string): Promise<Result<CouncilsEffectsDto, AppError>> {
  const human = requireHuman(ctx);
  if (!human.ok) return human;
  return inTx(deps, ctx, async (tx) => {
    const loaded = await loadCouncil(tx, councilId, { lock: true });
    if (!loaded.ok) return loaded;
    const ev = new EventBuffer(deps, ctx);
    const planned = await planEffects(deps, ctx, tx, ev, loaded.value);
    if (planned.created === 0 && (await repo.listEffectsOfCouncil(tx, councilId)).length === 0) {
      return err(conflict(CouncilsCode.INVALID_STATE, "Aucun effet n'est encore planifiable : la séance n'a pas atteint l'état configuré ou n'a aucune décision."));
    }
    await applyPendingEffects(deps, ctx, tx, ev, loaded.value);
    await ev.flush(tx);
    const rows = await repo.listEffectsOfCouncil(tx, councilId);
    return ok({ items: await enrich(deps, ctx, tx, rows), total: rows.length });
  });
}

async function loadEffect(tx: Tx, id: string): Promise<Result<{ effect: EffectRow; council: CouncilRow }, AppError>> {
  const effect = await repo.getEffect(tx, id, { lock: true });
  if (!effect) return err(notFound(CouncilsCode.NOT_FOUND, "Effet", id));
  const council = await councilsRepo.getCouncil(tx, effect.councilId, { lock: true });
  if (!council) return err(notFound(CouncilsCode.NOT_FOUND, "Conseil", effect.councilId));
  return ok({ effect, council });
}

/** Relance un effet en échec ou en attente (action de la direction) : nouvelle tentative immédiate. */
export async function retryEffect(deps: CouncilsDeps, ctx: RequestContext, caps: CallerCaps, id: string): Promise<Result<CouncilsEffectDto, AppError>> {
  const human = requireHuman(ctx);
  if (!human.ok) return human;
  return inTx(deps, ctx, async (tx) => {
    const loaded = await loadEffect(tx, id);
    if (!loaded.ok) return loaded;
    const { effect, council } = loaded.value;
    if (effect.status === "AWAITING_HUMAN") return err(conflict(CouncilsCode.INVALID_STATE, "Cet effet attend l'acte d'un utilisateur habilité : utilisez « appliquer »."));
    if (effect.status !== "PENDING" && effect.status !== "FAILED") return err(conflict(CouncilsCode.INVALID_STATE, `Un effet ${effect.status} ne se relance pas.`));
    if (!caps.effectManage) return err(forbidden(CouncilsCode.PERMISSION_REQUIRED, "Relancer un effet exige l'autorisation de gérer les effets."));
    const ev = new EventBuffer(deps, ctx);
    if (effect.status === "FAILED") await repo.requeueEffect(tx, id);
    const current = (await repo.getEffect(tx, id)) as EffectRow;
    const outcome = await attemptEffect(deps, ctx, tx, ev, council, current, false);
    await ev.flush(tx);
    if (outcome.status === "PENDING" && outcome.error) return err(outcome.error);
    return ok((await enrich(deps, ctx, tx, [(await repo.getEffect(tx, id)) as EffectRow]))[0] as CouncilsEffectDto);
  });
}

/**
 * Application d'un effet par un humain. Pour l'exclusion (`AWAITING_HUMAN`) : l'acte d'un utilisateur habilité
 * (`council.exclusion.apply`), jamais d'un job ni du système (refusé par le module ET par la base).
 */
export async function applyEffect(deps: CouncilsDeps, ctx: RequestContext, caps: CallerCaps, id: string): Promise<Result<CouncilsEffectDto, AppError>> {
  const human = requireHuman(ctx);
  if (!human.ok) return human;
  return inTx(deps, ctx, async (tx) => {
    const loaded = await loadEffect(tx, id);
    if (!loaded.ok) return loaded;
    const { effect, council } = loaded.value;
    if (effect.status !== "AWAITING_HUMAN" && effect.status !== "PENDING" && effect.status !== "FAILED") return err(conflict(CouncilsCode.INVALID_STATE, `Un effet ${effect.status} ne s'applique pas.`));
    if (effect.effectKind === "STUDENT_STATUS_REQUEST" || effect.status === "AWAITING_HUMAN") {
      if (!caps.exclusionApply) return err(forbidden(CouncilsCode.PERMISSION_REQUIRED, "Appliquer l'effet d'une exclusion exige l'autorisation dédiée."));
    } else if (!caps.effectManage) {
      return err(forbidden(CouncilsCode.PERMISSION_REQUIRED, "Appliquer un effet exige l'autorisation de gérer les effets."));
    }
    const ev = new EventBuffer(deps, ctx);
    if (effect.status === "FAILED") await repo.requeueEffect(tx, id);
    const current = (await repo.getEffect(tx, id)) as EffectRow;
    const outcome = await attemptEffect(deps, ctx, tx, ev, council, current, true);
    await ev.flush(tx);
    if (outcome.status === "PENDING" && outcome.error) return err(outcome.error);
    return ok((await enrich(deps, ctx, tx, [(await repo.getEffect(tx, id)) as EffectRow]))[0] as CouncilsEffectDto);
  });
}

export async function skipEffect(deps: CouncilsDeps, ctx: RequestContext, caps: CallerCaps, id: string, input: { reason?: string | undefined }): Promise<Result<CouncilsEffectDto, AppError>> {
  const human = requireHuman(ctx);
  if (!human.ok) return human;
  const reason = input.reason?.trim() ?? "";
  if (reason.length < 5) return err(invalid(CouncilsCode.INVALID_INPUT, "Un motif de 5 caractères au moins est requis pour écarter un effet.", "reason"));
  return inTx(deps, ctx, async (tx) => {
    const loaded = await loadEffect(tx, id);
    if (!loaded.ok) return loaded;
    const { effect } = loaded.value;
    if (!canTransition(EFFECT_TRANSITIONS, effect.status, "SKIPPED")) return err(conflict(CouncilsCode.INVALID_STATE, `Un effet ${effect.status} ne s'écarte pas.`));
    const needsExclusionRight = effect.status === "AWAITING_HUMAN" || effect.effectKind === "STUDENT_STATUS_REQUEST";
    if (needsExclusionRight ? !caps.exclusionApply : !caps.effectManage) return err(forbidden(CouncilsCode.PERMISSION_REQUIRED, "Écarter cet effet exige une autorisation dédiée."));
    await repo.skipEffect(tx, id, reason);
    const ev = new EventBuffer(deps, ctx);
    ev.audit({ action: "councils.effect.skipped", resourceType: "effect", resourceId: id, sensitive: needsExclusionRight, reason, after: { kind: effect.effectKind } });
    await ev.flush(tx);
    return ok((await enrich(deps, ctx, tx, [(await repo.getEffect(tx, id)) as EffectRow]))[0] as CouncilsEffectDto);
  });
}

/** Annule un effet appliqué (motif obligatoire). Voir l'en-tête pour les natures dont l'annulation passe par `results`. */
export async function revertEffect(deps: CouncilsDeps, ctx: RequestContext, caps: CallerCaps, id: string, input: { reason: string }): Promise<Result<CouncilsEffectDto, AppError>> {
  const human = requireHuman(ctx);
  if (!human.ok) return human;
  const reason = input.reason.trim();
  if (reason.length < 5) return err(invalid(CouncilsCode.INVALID_INPUT, "Un motif de 5 caractères au moins est requis pour annuler un effet.", "reason"));
  return inTx(deps, ctx, async (tx) => {
    const loaded = await loadEffect(tx, id);
    if (!loaded.ok) return loaded;
    const { effect, council } = loaded.value;
    if (effect.status !== "APPLIED") return err(conflict(CouncilsCode.INVALID_STATE, `Seul un effet appliqué s'annule (état : ${effect.status}).`));
    if (effect.irreversible) return err(conflict("councils.effect_irreversible", "Cet effet ne peut plus être annulé."));
    const kind = effect.effectKind as EffectKind;
    const isExclusion = kind === "STUDENT_STATUS_REQUEST";
    if (isExclusion ? !caps.exclusionApply : !caps.effectManage) return err(forbidden(CouncilsCode.PERMISSION_REQUIRED, "Annuler cet effet exige une autorisation dédiée."));
    if (REVERTED_BY_RESULTS_REOPEN.includes(kind)) {
      // Retrait unitaire dans `results` quand son API l'offre ; sinon (ou référence inconnue) : annulation par la réouverture de la période.
      const withdraw = deps.ports.resultsWrite.withdrawDecision;
      if (!withdraw || !effect.externalRef) {
        return err(conflict("councils.effect_revert_via_results", "Cet effet s'annule par la réouverture de la période de résultats : l'annulation sera enregistrée automatiquement."));
      }
      try {
        await withdraw.call(deps.ports.resultsWrite, ctx, { decisionId: effect.externalRef, reason, councilRef: effect.decisionId ? decisionRefOf(effect.decisionId) : effect.proposalId ? proposalRefOf(effect.proposalId) : councilRefOf(council.id) });
      } catch (e) {
        if (isAppError(e)) return err(e); // refus de `results` (période clôturée, décision publiée…) : l'effet reste appliqué
        throw e;
      }
    }
    const decision = effect.decisionId ? await councilsRepo.getDecision(tx, effect.decisionId) : null;
    if (kind === "STUDENT_STATUS_REQUEST") {
      if (!decision) return err(notFound(CouncilsCode.NOT_FOUND, "Décision", effect.decisionId ?? undefined));
      await deps.ports.studentStatus.changeStudentStatus(ctx, { studentId: decision.studentId, status: "ACTIVE", reasonText: reason });
    } else if (kind === "ORIENTATION_FILE" && effect.externalRef) {
      const file = await orientationRepo.getFile(tx, effect.externalRef, { lock: true });
      if (file && file.status === "DECIDED") await orientationRepo.updateFile(tx, file.id, { status: "PROPOSED", decisionId: null });
      else if (file && file.status !== "PROPOSED") return err(conflict(CouncilsCode.INVALID_STATE, `Le dossier d'orientation est ${file.status} : l'avis ne peut plus être retiré.`));
    } else if (kind === "SERIES_TRANSFER" && effect.externalRef) {
      const transfer = await orientationRepo.getTransfer(tx, effect.externalRef, { lock: true });
      if (transfer && transfer.status === "PLANNED") {
        await orientationRepo.cancelTransfer(tx, transfer.id, reason);
      } else if (transfer && transfer.status === "APPLIED") {
        await repo.markEffectIrreversible(tx, id);
        return err(conflict("councils.effect_irreversible", "Le transfert de série est déjà appliqué à l'inscription : l'effet ne peut plus être annulé."));
      }
    }
    await repo.markEffectReverted(tx, id, reason, deps.clock.now());
    const ev = new EventBuffer(deps, ctx);
    emitEffect(ev, effect, "REVERTED");
    ev.audit({ action: "councils.effect.reverted", resourceType: "effect", resourceId: id, sensitive: isExclusion, reason, after: { kind, councilId: council.id } });
    await ev.flush(tx);
    return ok((await enrich(deps, ctx, tx, [(await repo.getEffect(tx, id)) as EffectRow]))[0] as CouncilsEffectDto);
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Job : relance automatique des effets en attente / en échec
// ---------------------------------------------------------------------------------------------------------------------

export interface ProcessReport {
  readonly attempted: number;
  readonly applied: number;
  readonly failed: number;
}

/**
 * `councils.apply-effects` (30 s) : rejoue les effets `PENDING` / `FAILED` (jamais ceux d'un humain), tentatives bornées. Les écritures
 * en aval exigent un utilisateur identifié : l'effet est rejoué au nom de l'humain qui a ENREGISTRÉ la décision (ou résolu la
 * proposition), tracé par la référence opaque de l'acte source ; une décision n'est jamais inventée par le job.
 */
export async function processRunnableEffects(deps: CouncilsDeps, ctx: RequestContext, limit = 50): Promise<Result<ProcessReport, AppError>> {
  // 1. Inventaire sous le contexte du job (lecture seule) ; 2. chaque effet est rejoué dans SA transaction, sous l'identité de l'humain
  // qui a enregistré la décision (le changement d'identité DANS une transaction est refusé par la base).
  const listed = await inTx(
    deps,
    ctx,
    async (tx) => {
      const rows = await repo.listRunnableEffects(tx, deps.config.effectMaxAttempts, limit);
      const out: Array<{ effectId: string; actorUser: string | null }> = [];
      for (const effect of rows) {
        const decision = effect.decisionId ? await councilsRepo.getDecision(tx, effect.decisionId) : null;
        const proposal = effect.proposalId ? await councilsRepo.getProposal(tx, effect.proposalId) : null;
        out.push({ effectId: effect.id, actorUser: decision?.recordedBy ?? proposal?.resolvedBy ?? null });
      }
      return ok(out);
    },
    { readOnly: true },
  );
  if (!listed.ok) return listed;
  let applied = 0;
  let failed = 0;
  let attempted = 0;
  for (const item of listed.value) {
    if (!item.actorUser) continue;
    const actorCtx = createRequestContext({ tenantId: ctx.tenantId, userId: item.actorUser, actor: "user", roles: [], requestId: ctx.requestId });
    const r = await inTx(deps, actorCtx, async (tx) => {
      const effect = await repo.getEffect(tx, item.effectId, { lock: true });
      if (!effect || (effect.status !== "PENDING" && effect.status !== "FAILED") || effect.attempts >= deps.config.effectMaxAttempts) return ok("SKIPPED" as const);
      const council = await councilsRepo.getCouncil(tx, effect.councilId, { lock: true });
      if (!council) return ok("SKIPPED" as const);
      const ev = new EventBuffer(deps, actorCtx);
      if (effect.status === "FAILED") await repo.requeueEffect(tx, effect.id);
      const current = (await repo.getEffect(tx, effect.id)) as EffectRow;
      const outcome = await attemptEffect(deps, actorCtx, tx, ev, council, current, false);
      await ev.flush(tx);
      return ok(outcome.status);
    });
    if (!r.ok) {
      failed += 1;
      attempted += 1;
      continue;
    }
    if (r.value === "SKIPPED") continue;
    attempted += 1;
    if (r.value === "APPLIED") applied += 1;
    else if (r.value === "FAILED") failed += 1;
  }
  return ok({ attempted, applied, failed });
}

// ---------------------------------------------------------------------------------------------------------------------
// Réaction à la réouverture d'une période de résultats (AC5.6)
// ---------------------------------------------------------------------------------------------------------------------

/**
 * `results.period.reopened` : `results` a retiré ses décisions confirmées. Les effets appliqués de nature `RESULTS_DECISION` /
 * `RESULTS_DISTINCTION` de cet état sont enregistrés `REVERTED` (la réouverture d'un conseil redevient possible) et la direction est
 * alertée (« conseil à revoir ») pour chaque séance clôturée ou signée. `councils` ne rouvre JAMAIS un conseil de lui-même.
 */
export async function onResultsReopened(deps: CouncilsDeps, ctx: RequestContext, input: { stateId: string; occurredAt: Date }): Promise<Result<{ councils: number; reverted: number }, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const councils = (await councilsRepo.listCouncilsByStateIds(tx, [input.stateId])).filter((c) => c.status !== "CANCELLED");
    const ev = new EventBuffer(deps, ctx);
    let reverted = 0;
    for (const council of councils) {
      for (const effect of await repo.listAppliedEffectsOfCouncils(tx, [council.id], REVERTED_BY_RESULTS_REOPEN)) {
        await repo.markEffectReverted(tx, effect.id, "Période de résultats rouverte : décision retirée par le module des résultats.", input.occurredAt);
        emitEffect(ev, effect, "REVERTED");
        reverted += 1;
      }
      if ((council.status === "CLOSED" || council.status === "SIGNED") && !(await minutesRepo.hasReopenSignal(tx, council.id))) {
        await minutesRepo.appendEvent(tx, { id: deps.newId(), tenantId: ctx.tenantId, councilId: council.id, kind: "RESULTS_REOPENED", actorId: null, actorKind: "system", reason: null, data: { stateId: input.stateId } });
        ev.add(CouncilsEvents.COUNCIL_REVIEW_NEEDED, { ...councilPayload(council), cause: "RESULTS_REOPENED" }, { type: "councils.council", id: council.id });
      }
    }
    await ev.flush(tx);
    return ok({ councils: councils.length, reverted });
  });
}
