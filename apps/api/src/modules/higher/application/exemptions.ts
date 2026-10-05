/**
 * Dispense d'UE manuelle avec motif (décision O-14).
 *
 * La direction dispense un étudiant d'une UE : décision humaine, MOTIVÉE (10 caractères au moins), tracée (auteur, date, audit
 * sensible, événement `higher.ue.exempted`), révocable (`higher.ue.exemption_revoked`). Permission dédiée
 * `higher.exemption.grant` ; aucune séparation des tâches n'est exigée.
 *
 * Impact sur les crédits et la validation : PARAMÈTRE de l'établissement `exemption_credit_policy` (jamais une règle codée) :
 *  - `RECORD_ONLY` (défaut) : la dispense est seulement enregistrée ; le registre de crédits, la validation et l'éligibilité au
 *    diplôme ne changent pas ;
 *  - `GRANT_CREDITS` : une acquisition `EXEMPTION` est inscrite au registre (crédits de l'UE figés) ; l'UE compte comme acquise
 *    (prérequis, attestation, éligibilité) et lève une éventuelle dette. La politique appliquée est figée sur la dispense.
 *
 * Une UE annuelle (O-11) se dispense par son ancre : crédits = somme de ses parties.
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import { isCurrentlyValid, isoDateOf, sumCredits, validUntilFor } from "../domain/credits";
import { HigherCode, conflict, notFound, validation } from "../domain/errors";
import { HigherEvents } from "../domain/events";
import { DEFAULT_EXEMPTION_CREDIT_POLICY, EXEMPTION_REASON_MIN, grantsCredits, isExemptionCreditPolicy, type ExemptionCreditPolicy, type ExemptionStatus, type UeExemption } from "../domain/exemption";
import type { Uuid } from "../domain/types";
import * as annualRepo from "../infrastructure/annual-ue-repository";
import * as repo from "../infrastructure/exemption-repository";
import * as ledger from "../infrastructure/ledger-repository";
import { EventBuffer, inTx, lockKey, todayOf, type HigherDeps } from "./deps";

export interface GrantExemptionInput {
  readonly studentId: Uuid;
  /** Inscription de l'étudiant au cours de laquelle la dispense est accordée. */
  readonly enrollmentId: Uuid;
  /** Lignée de l'UE (ancre pour une UE annuelle). */
  readonly ueNodeId: Uuid;
  /** Semestre de rattachement de l'écriture au registre (si la politique accorde les crédits). */
  readonly academicPeriodId: Uuid;
  readonly reason: string;
}

const reasonOf = (raw: string | undefined): string => (raw ?? "").trim();

export async function grantExemption(deps: HigherDeps, ctx: RequestContext, input: GrantExemptionInput): Promise<Result<UeExemption, AppError>> {
  const reason = reasonOf(input.reason);
  if (reason.length < EXEMPTION_REASON_MIN) {
    return err(validation(HigherCode.EXEMPTION_REASON_REQUIRED, `Le motif de la dispense (${EXEMPTION_REASON_MIN} caractères au moins) est obligatoire.`, "reason"));
  }
  if (!ctx.userId) return err(validation(HigherCode.INVALID_INPUT, "Un utilisateur est requis pour accorder une dispense.", "userId"));
  const grantedBy = ctx.userId;

  const ue = await deps.ports.curriculum.getUe(ctx, input.ueNodeId);
  if (!ue) return err(notFound(HigherCode.EXEMPTION_UNKNOWN_UE, "UE du curriculum", input.ueNodeId));
  const enrollment = await deps.ports.enrollments.getEnrollment(ctx, input.enrollmentId);
  if (!enrollment || enrollment.studentId !== input.studentId || !enrollment.active) {
    return err(validation(HigherCode.EXEMPTION_ENROLLMENT_MISMATCH, "L'inscription indiquée n'est pas une inscription active de cet étudiant.", "enrollmentId"));
  }

  // UE annuelle : on dispense l'ancre ; les crédits sont ceux de l'ensemble de ses parties.
  const def = await deps.db.run(ctx, (tx) => annualRepo.getDefOfMember(tx, input.ueNodeId), { readOnly: true });
  let credits = ue.credits;
  if (def) {
    if (def.ueNodeId !== input.ueNodeId) {
      return err(validation(HigherCode.EXEMPTION_UNKNOWN_UE, "Cette UE est une partie d'une UE annuelle : dispensez l'UE annuelle par son UE principale.", "ueNodeId", { annualUeNodeId: def.ueNodeId }));
    }
    const all: number[] = [];
    for (const m of def.memberNodeIds) {
      const part = await deps.ports.curriculum.getUe(ctx, m);
      if (part) all.push(part.credits);
    }
    credits = sumCredits(all);
  }

  return inTx(deps, ctx, async (tx) => {
    await lockKey(tx, ctx, "exemption", `${input.studentId}:${input.ueNodeId}`);
    if (await repo.findActive(tx, input.studentId, input.ueNodeId)) {
      return err(conflict(HigherCode.EXEMPTION_EXISTS, "Cet étudiant est déjà dispensé de cette UE."));
    }
    const policy = await repo.getPolicy(tx);
    const now = deps.clock.now();
    const id = deps.newId();
    const events = new EventBuffer(deps, ctx);
    let ledgerId: Uuid | null = null;

    if (grantsCredits(policy)) {
      const existing = await ledger.findAcquired(tx, input.studentId, input.ueNodeId, true);
      if (existing && isCurrentlyValid(existing, todayOf(deps))) {
        return err(conflict(HigherCode.EXEMPTION_UE_ACQUIRED, "Cette UE est déjà acquise : aucune dispense de crédits n'est nécessaire.", { ledgerId: existing.id }));
      }
      if (existing) await ledger.markExpired(tx, existing.id, now);
      const settings = await ledger.getSettings(tx);
      const entry = await ledger.insertAcquisition(tx, {
        id: deps.newId(),
        tenantId: ctx.tenantId,
        studentId: input.studentId,
        enrollmentId: input.enrollmentId,
        ueNodeId: input.ueNodeId,
        academicYearId: enrollment.academicYearId,
        academicPeriodId: input.academicPeriodId,
        credits,
        averageExact: null,
        acquiredVia: "EXEMPTION",
        sessionObtained: 1,
        compensatedEcueCount: 0,
        overrideId: null,
        sourceResultId: id, // pas de résultat : la dispense elle-même est la source
        sourceResultsVersion: 0,
        validUntil: validUntilFor(isoDateOf(now), settings.creditValidityMonths),
        acquiredAt: now,
      });
      if (!entry) return err(conflict(HigherCode.EXEMPTION_UE_ACQUIRED, "Cette UE vient d'être acquise : aucune dispense de crédits n'est nécessaire."));
      ledgerId = entry.id;
      await ledger.clearDebts(tx, input.studentId, input.ueNodeId, now, entry.id);
      events.add(
        HigherEvents.CREDITS_CAPITALIZED,
        { v: 1, studentId: entry.studentId, ueNodeId: entry.ueNodeId, credits: entry.credits, yearId: entry.academicYearId, via: entry.acquiredVia, sessionObtained: entry.sessionObtained, ledgerId: entry.id },
        { type: "credit_ledger", id: entry.id },
      );
    }

    await repo.insertExemption(tx, ctx.tenantId, {
      id,
      studentId: input.studentId,
      enrollmentId: input.enrollmentId,
      ueNodeId: input.ueNodeId,
      academicYearId: enrollment.academicYearId,
      academicPeriodId: input.academicPeriodId,
      credits,
      reason,
      creditPolicy: policy,
      ledgerId,
      grantedBy,
      grantedAt: now,
    });
    events.add(
      HigherEvents.UE_EXEMPTED,
      { v: 1, exemptionId: id, studentId: input.studentId, ueNodeId: input.ueNodeId, enrollmentId: input.enrollmentId, creditPolicy: policy, ledgerId },
      { type: "ue_exemption", id },
    );
    events.audit({
      action: "higher.exemption.granted",
      resourceType: "ue_exemption",
      resourceId: id,
      sensitive: true,
      reason,
      after: { studentId: input.studentId, ueNodeId: input.ueNodeId, creditPolicy: policy, credits, ledgerId },
    });
    await events.flush(tx);
    return ok((await repo.getExemption(tx, id)) as UeExemption);
  });
}

export interface RevokeExemptionInput {
  readonly id: Uuid;
  readonly reason: string;
}

/** Révoque une dispense (motif obligatoire). L'écriture de crédits qu'elle avait produite est révoquée, sauf si un diplôme s'y appuie. */
export async function revokeExemption(deps: HigherDeps, ctx: RequestContext, input: RevokeExemptionInput): Promise<Result<UeExemption, AppError>> {
  const reason = reasonOf(input.reason);
  if (reason.length < EXEMPTION_REASON_MIN) {
    return err(validation(HigherCode.EXEMPTION_REASON_REQUIRED, `Le motif de la révocation (${EXEMPTION_REASON_MIN} caractères au moins) est obligatoire.`, "reason"));
  }
  if (!ctx.userId) return err(validation(HigherCode.INVALID_INPUT, "Un utilisateur est requis pour révoquer une dispense.", "userId"));
  const by = ctx.userId;
  return inTx(deps, ctx, async (tx) => {
    const found = await repo.getExemption(tx, input.id, true);
    if (!found) return err(notFound(HigherCode.EXEMPTION_NOT_FOUND, "Dispense", input.id));
    if (found.status === "REVOKED") return err(conflict(HigherCode.EXEMPTION_ALREADY_REVOKED, "Cette dispense est déjà révoquée."));
    const now = deps.clock.now();
    const events = new EventBuffer(deps, ctx);
    if (found.ledgerId) {
      const awards = await ledger.listAwardsUsingLedger(tx, found.studentId, found.ledgerId);
      if (awards.length > 0) {
        return err(conflict(HigherCode.CREDIT_IN_USE, "Un diplôme octroyé s'appuie sur les crédits de cette dispense : révoquez d'abord le diplôme.", { awardIds: awards }));
      }
      if (await ledger.markRevoked(tx, found.ledgerId, now, `Dispense révoquée : ${reason}`, null)) {
        events.add(HigherEvents.CREDITS_REVOKED, { v: 1, ledgerId: found.ledgerId, studentId: found.studentId, ueNodeId: found.ueNodeId, reason: "exemption_revoked" }, { type: "credit_ledger", id: found.ledgerId });
      }
    }
    await repo.markRevoked(tx, found.id, by, now, reason);
    events.add(HigherEvents.UE_EXEMPTION_REVOKED, { v: 1, exemptionId: found.id, studentId: found.studentId, ueNodeId: found.ueNodeId }, { type: "ue_exemption", id: found.id });
    events.audit({ action: "higher.exemption.revoked", resourceType: "ue_exemption", resourceId: found.id, sensitive: true, reason, before: { status: "ACTIVE", ledgerId: found.ledgerId } });
    await events.flush(tx);
    return ok((await repo.getExemption(tx, found.id)) as UeExemption);
  });
}

export async function listExemptions(
  deps: HigherDeps,
  ctx: RequestContext,
  filter: { studentId?: Uuid | undefined; ueNodeId?: Uuid | undefined; status?: ExemptionStatus | undefined; limit?: number | undefined } = {},
): Promise<Result<UeExemption[], AppError>> {
  return inTx(deps, ctx, async (tx) => ok(await repo.listExemptions(tx, filter)), { readOnly: true });
}

/** Code et libellé des UE (lecture du curriculum, pour l'affichage) ; une UE inconnue n'a pas d'entrée. */
export async function describeUes(deps: HigherDeps, ctx: RequestContext, ueNodeIds: readonly Uuid[]): Promise<Map<Uuid, { code: string; label: string }>> {
  const out = new Map<Uuid, { code: string; label: string }>();
  for (const id of new Set(ueNodeIds)) {
    const ue = await deps.ports.curriculum.getUe(ctx, id).catch(() => null);
    if (ue) out.set(id, { code: ue.code, label: ue.label });
  }
  return out;
}

export async function getExemptionSettings(deps: HigherDeps, ctx: RequestContext): Promise<Result<{ exemptionCreditPolicy: ExemptionCreditPolicy }, AppError>> {
  return inTx(deps, ctx, async (tx) => ok({ exemptionCreditPolicy: await repo.getPolicy(tx) }), { readOnly: true });
}

/** Change la politique de crédits des FUTURES dispenses (les dispenses existantes gardent celle qui leur a été appliquée). */
export async function setExemptionCreditPolicy(deps: HigherDeps, ctx: RequestContext, input: { exemptionCreditPolicy: ExemptionCreditPolicy }): Promise<Result<{ exemptionCreditPolicy: ExemptionCreditPolicy }, AppError>> {
  if (!isExemptionCreditPolicy(input.exemptionCreditPolicy)) {
    return err(validation(HigherCode.INVALID_INPUT, "Politique de dispense inconnue.", "exemptionCreditPolicy"));
  }
  return inTx(deps, ctx, async (tx) => {
    const before = (await repo.getPolicy(tx)) ?? DEFAULT_EXEMPTION_CREDIT_POLICY;
    await repo.setPolicy(tx, ctx.tenantId, input.exemptionCreditPolicy, ctx.userId, deps.clock.now());
    const events = new EventBuffer(deps, ctx);
    events.audit({ action: "higher.exemption_policy.updated", resourceType: "higher_settings", resourceId: ctx.tenantId, sensitive: true, before: { exemptionCreditPolicy: before }, after: { exemptionCreditPolicy: input.exemptionCreditPolicy } });
    await events.flush(tx);
    return ok({ exemptionCreditPolicy: input.exemptionCreditPolicy });
  });
}
