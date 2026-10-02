/**
 * Décision formelle (US7) et promotion depuis la liste d'attente (US8).
 *
 * La ligne de `decisions` est insérée AVANT le changement d'étape, dans la MÊME transaction, avec l'étape de départ égale à
 * l'étape COURANTE du dossier ; le déclencheur `applications_guard` refuse l'entrée dans une étape à décision sans elle (même
 * par SQL direct). Journal en ajout seul ; identité du décideur FIGÉE.
 *
 * Promotion : quand une place se libère (retrait, offre expirée, délai de paiement dépassé), `MANUAL` (le secrétariat propose la
 * place) ou `AUTO` (offre proposée au premier de la liste, décision SYSTÈME). Une seule place n'est offerte qu'une fois : la ligne
 * de capacité est verrouillée par le déclencheur, le perdant d'une course reçoit `NO_SEAT`.
 */
import type { Tx } from "@ecoledigitale/database";
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { AdmissionsApplicationDetailDto, AdmissionsDecisionBody, AdmissionDecisionKind } from "@ecoledigitale/contracts/src/v2/admissions";
import { AdmissionsCode, conflict, notFound, validation } from "../domain/errors";
import { AdmissionsEvents } from "../domain/events";
import { decisionKindFor } from "../domain/workflow";
import * as apps from "../infrastructure/application-repository";
import * as cases from "../infrastructure/case-repository";
import { mapDbError } from "../infrastructure/db-errors";
import * as ref from "../infrastructure/reference-repository";
import * as reports from "../infrastructure/reports-repository";
import * as wf from "../infrastructure/workflow-repository";
import { buildDetail } from "./applications";
import { EventBuffer, inTx, SYSTEM_ACTOR_ID, SYSTEM_ACTOR_NAME, type AdmissionsDeps, type TxScope } from "./deps";
import { issueOfferInTx, type IssuedOffer } from "./offer-core";
import { decider } from "./support";
import { applicationRef, moveStage, type MoveResult } from "./transitions";

export interface DecisionInput {
  readonly toStageId: string;
  readonly kind: AdmissionDecisionKind;
  readonly reasonCode?: string | undefined;
  readonly reasonText?: string | undefined;
  readonly conditions?: string | undefined;
  readonly overrideCapacity?: boolean | undefined;
  readonly offerId?: string | null | undefined;
  /** Décision SYSTÈME (promotion automatique, expiration) : l'identité figée est « Système ». */
  readonly asSystem?: boolean | undefined;
}

export interface DecisionOutcome {
  readonly decisionId: string;
  readonly move: MoveResult;
}

/** Insère la décision puis déplace le dossier (déjà verrouillé par l'appelant). */
export async function recordDecisionInTx(deps: AdmissionsDeps, ctx: RequestContext, tx: Tx, scope: TxScope, events: EventBuffer, app: apps.ApplicationRow, input: DecisionInput): Promise<Result<DecisionOutcome, AppError>> {
  if (app.anonymizedAt) return err(conflict(AdmissionsCode.APPLICATION_ANONYMIZED, "Ce dossier est anonymisé : il ne change plus."));
  const transition = await apps.getTransitionBetween(tx, app.workflowId, app.stageId, input.toStageId);
  if (!transition) return err(conflict(AdmissionsCode.TRANSITION_NOT_ALLOWED, "Cette transition n'est pas déclarée dans le workflow depuis l'étape courante du dossier."));
  if (!transition.requiresDecision) return err(conflict(AdmissionsCode.TRANSITION_NOT_ALLOWED, "L'étape visée n'exige pas de décision formelle : utilisez le changement d'étape."));
  const expected = decisionKindFor({ canonicalStatus: transition.toStatus as never, closureKind: transition.toClosureKind as never });
  if (expected !== input.kind) return err(validation(AdmissionsCode.DECISION_KIND_MISMATCH, `Le type de décision ${input.kind} ne correspond pas à l'étape visée (attendu : ${expected ?? "aucun"}).`, "kind"));
  if (transition.requiresReason && !input.reasonCode && !(input.reasonText && input.reasonText.trim().length >= 3)) {
    return err(validation(AdmissionsCode.REASON_REQUIRED, "Cette transition exige un motif.", "reasonCode"));
  }
  if (input.reasonCode) {
    if (!input.asSystem) {
      const reason = await ref.getDecisionReason(tx, app.institutionId, input.reasonCode);
      if (!reason || !reason.active) return err(validation(AdmissionsCode.REASON_UNKNOWN, "Motif de décision inconnu ou inactif.", "reasonCode"));
      if (reason.kind !== input.kind) return err(validation(AdmissionsCode.REASON_UNKNOWN, `Ce motif n'est pas un motif de type ${input.kind}.`, "reasonCode"));
    }
  } else if (input.kind === "REJECT" || input.kind === "WITHDRAW") {
    return err(validation(AdmissionsCode.REASON_REQUIRED, "Un refus ou un retrait cite un motif codé.", "reasonCode"));
  }

  const who = input.asSystem ? { id: SYSTEM_ACTOR_ID, name: SYSTEM_ACTOR_NAME } : await decider(deps, ctx);
  const decisionId = deps.newId();
  const override = input.overrideCapacity === true;
  await cases.insertDecision(tx, {
    id: decisionId,
    tenantId: ctx.tenantId,
    applicationId: app.id,
    kind: input.kind,
    fromStageId: app.stageId,
    toStageId: input.toStageId,
    reasonCode: input.reasonCode ?? null,
    reasonText: input.reasonText?.trim() ? input.reasonText.trim() : null,
    conditions: input.conditions?.trim() ? input.conditions.trim() : null,
    offerId: input.offerId ?? null,
    overrideCapacity: override,
    decidedBy: who.id,
    decidedByName: who.name,
  });
  const move = await moveStage(deps, ctx, tx, scope, events, app, input.toStageId, {
    capacityOverrideReason: override ? (input.reasonText?.trim() ?? null) : null,
    onSeatFreed: promoteOnFreedSeat,
  });
  events.add(AdmissionsEvents.DECISION_RECORDED, { v: 1, ...applicationRef(app), decisionId, kind: input.kind, reasonCode: input.reasonCode ?? null }, { type: "application", id: app.id });
  events.audit({
    action: "admissions.decision.record",
    resourceType: "application",
    resourceId: app.id,
    sensitive: override,
    reason: override ? "dépassement de capacité" : null,
    metadata: { decisionId, kind: input.kind, reasonCode: input.reasonCode ?? null, toStage: move.after.stageCode, overrideCapacity: override },
  });
  return ok({ decisionId, move });
}

export async function recordDecision(deps: AdmissionsDeps, ctx: RequestContext, applicationId: string, body: AdmissionsDecisionBody): Promise<Result<AdmissionsApplicationDetailDto, AppError>> {
  return inTx(deps, ctx, async (tx, scope) => {
    const app = await apps.getApplicationRow(tx, applicationId, { forUpdate: true });
    if (!app) return err(notFound(AdmissionsCode.APPLICATION_NOT_FOUND, "Candidature", applicationId));
    if (body.rowVersion !== undefined && body.rowVersion !== app.rowVersion) {
      return err(conflict(AdmissionsCode.VERSION_CONFLICT, "Le dossier a été modifié par une autre personne : rechargez-le.", { rowVersion: app.rowVersion }));
    }
    const events = new EventBuffer(deps, ctx);
    const out = await recordDecisionInTx(deps, ctx, tx, scope, events, app, body);
    if (!out.ok) return out;
    await events.flush(tx);
    return ok(await buildDetail(deps, tx, out.value.move.after));
  });
}

// ---------------------------------------------------------------------------
// Promotion depuis la liste d'attente
// ---------------------------------------------------------------------------

export interface PromotionResult {
  readonly promoted: boolean;
  readonly applicationId: string | null;
  /** `EMPTY`, `NO_SEAT`, `NOT_WAITLISTED`, `NO_TRANSITION`, `DISABLED` : pourquoi rien n'a été proposé. */
  readonly reason: string | null;
  readonly offer?: IssuedOffer;
}

export interface PromoteInput {
  readonly campaignId: string;
  readonly grade: string;
  readonly applicationId?: string | null | undefined;
  readonly classroomId?: string | null | undefined;
  readonly auto: boolean;
}

/**
 * Propose la place au premier de la liste (ou au dossier désigné) : décision ACCEPT (système si `auto`) puis offre. La tentative
 * s'exécute dans un SAVEPOINT : une course perdue sur la dernière place (`capacity_full`) renvoie `NO_SEAT` sans corrompre la
 * transaction de l'appelant.
 */
export async function promoteHead(deps: AdmissionsDeps, ctx: RequestContext, tx: Tx, scope: TxScope, input: PromoteInput): Promise<PromotionResult> {
  const entries = await reports.waitlistEntries(tx, input.campaignId, input.grade);
  const target = input.applicationId ? entries.find((e) => e.applicationId === input.applicationId) : entries[0];
  if (!target) return { promoted: false, applicationId: null, reason: "EMPTY" };
  const preview = await apps.getApplicationRow(tx, target.applicationId);
  if (!preview) return { promoted: false, applicationId: null, reason: "EMPTY" };
  const left = await wf.seatsLeft(tx, input.campaignId, input.grade, preview.desiredProgramId);
  if (left !== null && left <= 0) return { promoted: false, applicationId: target.applicationId, reason: "NO_SEAT" };

  const app = (await apps.getApplicationRow(tx, target.applicationId, { forUpdate: true })) as apps.ApplicationRow;
  if (app.status !== "WAITLISTED") return { promoted: false, applicationId: app.id, reason: "NOT_WAITLISTED" };
  const accept = (await apps.listTransitionsFrom(tx, app.workflowId, app.stageId)).find((t) => t.toStatus === "ACCEPTED" && !t.createsEnrollment && t.requiresDecision);
  if (!accept) return { promoted: false, applicationId: app.id, reason: "NO_TRANSITION" };

  const local = new EventBuffer(deps, ctx);
  // Effets post-commit de la tentative : transmis à l'appelant seulement si elle réussit (jamais de message pour une offre annulée).
  const pending: Array<() => Promise<void>> = [];
  const child: TxScope = { after: (effect) => void pending.push(effect) };
  try {
    const issued = await tx.transaction(async (sp) => {
      const decided = await recordDecisionInTx(deps, ctx, sp, child, local, app, { toStageId: accept.toStageId, kind: "ACCEPT", asSystem: input.auto });
      if (!decided.ok) throw decided.error;
      const offer = await issueOfferInTx(deps, ctx, sp, child, local, decided.value.move.after, { classroomId: input.classroomId ?? null });
      if (!offer.ok) throw offer.error;
      local.add(AdmissionsEvents.WAITLIST_PROMOTED, { v: 1, ...applicationRef(app), offerId: offer.value.offer.id, auto: input.auto }, { type: "application", id: app.id });
      local.audit({ action: "admissions.waitlist.promote", resourceType: "application", resourceId: app.id, metadata: { offerId: offer.value.offer.id, auto: input.auto } });
      return offer.value;
    });
    await local.flush(tx);
    for (const effect of pending) scope.after(effect);
    return { promoted: true, applicationId: app.id, reason: null, offer: issued };
  } catch (e) {
    const mapped = (e as { code?: string })?.code?.startsWith("admissions.") ? (e as AppError) : mapDbError(e);
    if (mapped?.code === AdmissionsCode.CAPACITY_FULL) return { promoted: false, applicationId: app.id, reason: "NO_SEAT" };
    throw mapped ?? e;
  }
}

/** Réaction à une place libérée : promotion AUTOMATIQUE si l'établissement l'a choisie (sinon la place est signalée par l'écran). */
export async function promoteOnFreedSeat(deps: AdmissionsDeps, ctx: RequestContext, tx: Tx, scope: TxScope, _events: EventBuffer, freed: apps.ApplicationRow): Promise<void> {
  const settings = await ref.getSettingsRow(tx, freed.institutionId);
  if (!settings || !settings.waitlistEnabled || settings.waitlistPromotion !== "AUTO") return;
  await promoteHead(deps, ctx, tx, scope, { campaignId: freed.campaignId, grade: freed.desiredGradeLevelCode, auto: true });
}
