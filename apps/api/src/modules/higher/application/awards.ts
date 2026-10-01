/**
 * Octrois de diplômes (US5, US6) : automatique (abonné `higher.credits.capitalized`), manuel, forcé, révocation, ré-octroi
 * exceptionnel, réévaluation de masse.
 *
 *  - L'ÉLIGIBILITÉ est la règle `diplome_eligible` (RuleSet) ; la moyenne de cycle et la mention sont `moyenne_annuelle` et
 *    `mention_diplome`. Ce module construit leur contexte (registre) et fige leurs sorties dans l'octroi (snapshot, version
 *    de règle, empreintes) : modifier ensuite la définition ou le curriculum ne change pas un octroi (AC5.4).
 *  - Un octroi forcé (non éligible) exige la permission sensible `higher.award.force` ET un motif de 20 caractères au moins.
 *  - Un étudiant n'a jamais deux octrois non révoqués pour la même définition (index unique + verrou).
 *  - Le numéro `DIP-AAAA-NNNNNN` vient du compteur transactionnel, dans la transaction de l'octroi : annulation = pas de trou.
 *  - La révocation est terminale ; le ré-octroi exige une décision écrite référencée + la permission de forçage (Q-22).
 *  - Mention en attente (semestre sans résultat FINAL) : l'octroi AUTOMATIQUE attend ; le manuel et le forcé peuvent
 *    s'enregistrer avec la mention `PENDING`.
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import { lastAcquisitionDate } from "../domain/credits";
import { MENTION_PENDING, buildRequirementsSnapshot, toEligibilityContext, type RequirementState } from "../domain/diploma";
import { HigherCode, conflict, forbidden, notFound, validation } from "../domain/errors";
import { HigherEvents } from "../domain/events";
import { formatDiplomaReference } from "../domain/numbering";
import { snapshotHash } from "../domain/snapshot";
import type { AwardedVia, DiplomaAward, DiplomaDefinition, IsoDate, Uuid } from "../domain/types";
import * as repo from "../infrastructure/diplomas-repository";
import * as docs from "../infrastructure/documents-repository";
import { loadStanding } from "./diplomas";
import { EventBuffer, currentYear, inTx, insertOrConflict, lockKey, todayOf, type CallerCaps, type HigherDeps } from "./deps";
import type { CycleEvaluation, CycleResults, EligibilityEvaluation, LastEnrollment, RuleScope } from "./ports";

export const AUTO_AWARD_ACTOR_NAME = "Système (octroi automatique)";
export const FORCE_REASON_MIN = 20;
export const REVOKE_REASON_MIN = 10;
export const REAWARD_DECISION_MIN = 20;

export type SkipReason = "DEFINITION_INACTIVE" | "ALREADY_AWARDED" | "REVOKED_BEFORE" | "NOT_ELIGIBLE" | "MENTION_PENDING" | "AUTO_AWARD_DISABLED" | "NOT_IN_CYCLE";

export type AwardOutcome =
  | { readonly status: "AWARDED"; readonly award: DiplomaAward }
  | { readonly status: "SKIPPED"; readonly reason: SkipReason };

export interface AwardInput {
  readonly definitionId: Uuid;
  readonly studentId: Uuid;
  readonly via: "AUTO" | "MANUAL";
  /** Octroi forcé : seulement pour un étudiant NON éligible (sinon l'octroi est simplement manuel). */
  readonly force?: boolean | undefined;
  /** Motif de l'octroi forcé (≥ 20 caractères). */
  readonly reason?: string | undefined;
  /** Ré-octroi après révocation : décision écrite du directeur général (référence, ≥ 20 caractères). */
  readonly reawardDecision?: string | undefined;
  readonly caps?: CallerCaps | undefined;
}

export const scopeOf = (deps: HigherDeps, def: DiplomaDefinition): RuleScope => ({
  ...(def.institutionId ? { institutionId: def.institutionId } : {}),
  curriculumNodeId: def.curriculumNodeId,
  onDate: todayOf(deps),
});

async function actorName(deps: HigherDeps, ctx: RequestContext): Promise<string> {
  if (!ctx.userId) return AUTO_AWARD_ACTOR_NAME;
  return (await deps.ports.actors.displayName(ctx, ctx.userId)) ?? ctx.userId;
}

/**
 * Octroie un diplôme. Automatique (`AUTO`) : jamais d'erreur pour une condition non remplie (le résultat est `SKIPPED` avec
 * la raison) ; manuel (`MANUAL`) : chaque condition non remplie est une erreur explicite.
 */
export async function awardDiploma(deps: HigherDeps, ctx: RequestContext, input: AwardInput): Promise<Result<AwardOutcome, AppError>> {
  const auto = input.via === "AUTO";
  if (!auto && !ctx.userId) return err(validation(HigherCode.INVALID_INPUT, "Un utilisateur est requis pour un octroi manuel.", "userId"));

  // --- lectures d'AUTRES modules, avant la transaction ---------------------------------------------------------------
  const head = await deps.db.run(ctx, (tx) => repo.getDefinition(tx, input.definitionId), { readOnly: true });
  if (!head) return err(notFound(HigherCode.DIPLOMA_NOT_FOUND, "Diplôme", input.definitionId));
  if (auto && head.status !== "ACTIVE") return ok({ status: "SKIPPED", reason: "DEFINITION_INACTIVE" });
  const cycle: CycleResults = await deps.ports.cycleResults.getCycleResults(ctx, { studentId: input.studentId, nodeId: head.curriculumNodeId });
  const lastEnrollment: LastEnrollment | null = await deps.ports.enrollments.getLastEnrollment(ctx, { studentId: input.studentId, nodeId: head.curriculumNodeId });
  const byName = auto ? AUTO_AWARD_ACTOR_NAME : await actorName(deps, ctx);

  return inTx(deps, ctx, async (tx) => {
    await lockKey(tx, ctx, "award", `${input.definitionId}:${input.studentId}`);
    const def = await repo.getDefinition(tx, input.definitionId, true);
    if (!def) return err(notFound(HigherCode.DIPLOMA_NOT_FOUND, "Diplôme", input.definitionId));
    const skip = (reason: SkipReason): Result<AwardOutcome, AppError> => ok({ status: "SKIPPED", reason });

    // 1) doublon / révocation antérieure
    const active = await repo.findActiveAward(tx, def.id, input.studentId);
    if (active) return auto ? skip("ALREADY_AWARDED") : err(conflict(HigherCode.ALREADY_AWARDED, "Cet étudiant a déjà ce diplôme.", { awardId: active.id, reference: active.reference }));
    const revoked = await repo.findLastRevokedAward(tx, def.id, input.studentId);
    let predecessor: DiplomaAward | null = null;
    if (revoked) {
      if (auto) return skip("REVOKED_BEFORE");
      const decision = input.reawardDecision?.trim() ?? "";
      if (!input.caps?.forceAward) return err(forbidden(HigherCode.REAWARD_FORBIDDEN, "Un diplôme révoqué ne se ré-octroie que par décision écrite du directeur général (permission de forçage requise).", { revokedAwardId: revoked.id }));
      if (decision.length < REAWARD_DECISION_MIN) return err(validation(HigherCode.REAWARD_FORBIDDEN, `La décision écrite référencée (${REAWARD_DECISION_MIN} caractères au moins) est obligatoire pour ré-octroyer un diplôme révoqué.`, "reawardDecision", { revokedAwardId: revoked.id }));
      predecessor = revoked;
    }

    // 2) position de l'étudiant et règles
    const standing = await loadStanding(deps, tx, def, input.studentId);
    const scope = scopeOf(deps, def);
    const elig = await deps.ports.rules.evaluateEligibility(ctx, { exigences: toEligibilityContext(standing.states), uvRequises: def.uvRequired, scope });
    if (!elig.ok) return elig;
    const eligibility: EligibilityEvaluation = elig.value;

    let cycleEval: CycleEvaluation | null = null;
    let mentionCode: string = MENTION_PENDING;
    let cycleAverage: string | null = null;
    if (cycle.complete && cycle.semesters.length > 0) {
      const ev = await deps.ports.rules.evaluateCycle(ctx, { semestres: cycle.semesters.map((s) => ({ moyenne: s.average, credits: s.credits })), scope });
      if (!ev.ok) return ev;
      cycleEval = ev.value;
      mentionCode = ev.value.mentionCode;
      cycleAverage = ev.value.average;
    }

    // 3) décision
    const events = new EventBuffer(deps, ctx);
    let via: AwardedVia = auto ? "AUTO" : "MANUAL";
    let forcedReason: string | null = null;
    if (!eligibility.eligible) {
      if (auto) return skip("NOT_ELIGIBLE");
      if (!input.force) {
        return err(
          conflict(HigherCode.NOT_ELIGIBLE, "L'étudiant n'est pas éligible à ce diplôme.", {
            missingMandatory: standing.progress.missingMandatory.map((s) => s.ueNodeId),
            uvValidated: standing.progress.uvValidated,
            uvRequired: def.uvRequired,
          }),
        );
      }
      if (!input.caps?.forceAward) return err(forbidden(HigherCode.FORBIDDEN, "L'octroi forcé exige la permission « higher.award.force »."));
      const reason = input.reason?.trim() ?? "";
      if (reason.length < FORCE_REASON_MIN) return err(validation(HigherCode.FORCE_REASON_REQUIRED, `Le motif d'un octroi forcé doit faire au moins ${FORCE_REASON_MIN} caractères.`, "reason"));
      via = "FORCED";
      forcedReason = reason;
    } else if (auto) {
      if (!def.autoAward) {
        events.add(HigherEvents.DIPLOMA_ELIGIBLE, { v: 1, studentId: input.studentId, definitionId: def.id }, { type: "diploma_definition", id: def.id });
        await events.flush(tx);
        return skip("AUTO_AWARD_DISABLED");
      }
      if (mentionCode === MENTION_PENDING) return skip("MENTION_PENDING");
    }

    const acquiredDate: IsoDate | null = lastAcquisitionDate(standing.ledgerEntries);
    if (!acquiredDate && via !== "FORCED") return err(validation(HigherCode.INVALID_INPUT, "Aucune acquisition de crédits ne fonde cet octroi.", "studentId"));
    if (!lastEnrollment && via !== "FORCED") {
      return auto ? skip("NOT_IN_CYCLE") : err(validation(HigherCode.STUDENT_NOT_IN_CYCLE, "L'étudiant n'a aucune inscription dans ce cycle.", "studentId"));
    }

    // 4) écriture : numéro, snapshot figé, octroi
    const now = deps.clock.now();
    const states: readonly RequirementState[] = standing.states;
    const snapshot = buildRequirementsSnapshot(states, def.uvRequired, now);
    const definitionHash = snapshotHash({
      v: 1,
      definition: { code: def.code, label: def.label, gradeCode: def.gradeCode, curriculumNodeId: def.curriculumNodeId, uvRequired: def.uvRequired },
      requirements: states.map((s) => ({ ueNodeId: s.ueNodeId, mandatory: s.mandatory })),
    });
    const year = currentYear(deps);
    const seq = await docs.nextNumber(tx, "DIPLOMA", year);
    const inserted = await insertOrConflict(
      tx,
      (t) =>
        repo.insertAward(t, {
          id: deps.newId(), tenantId: ctx.tenantId, definitionId: def.id, studentId: input.studentId, lastEnrollmentId: lastEnrollment?.enrollmentId ?? null,
          academicYearId: lastEnrollment?.academicYearId ?? null, reference: formatDiplomaReference(year, seq), referenceYear: year, referenceSeq: seq,
          awardedVia: via, forcedReason, creditsTotal: standing.progress.uvValidated, requirementsSnapshot: snapshot,
          eligibility: {
            v: 1,
            eligible: eligibility.eligible,
            rule: eligibility.rule,
            inputsHash: eligibility.inputsHash,
            outputsHash: eligibility.outputsHash,
            ...(cycleEval ? { cycle: { average: cycleEval.average, mentionCode: cycleEval.mentionCode, rule: cycleEval.rule } } : { cycle: { complete: false } }),
          },
          cycleAverage, mentionCode, ruleSetCode: eligibility.rule.ruleSetCode, ruleVersionId: eligibility.rule.ruleVersionId, ruleVersionNo: eligibility.rule.versionNo,
          definitionHash, awardedAt: now, awardedBy: ctx.userId, awardedByName: byName, acquiredDate, predecessorAwardId: predecessor?.id ?? null,
          reawardDecision: predecessor ? (input.reawardDecision?.trim() ?? null) : null,
        }),
      () => conflict(HigherCode.ALREADY_AWARDED, "Cet étudiant a déjà ce diplôme."),
    );
    if (!inserted.ok) return inserted; // le numéro consommé est annulé avec la transaction (aucun trou)
    const award = inserted.value;

    events.add(
      HigherEvents.DIPLOMA_AWARDED,
      { v: 1, awardId: award.id, studentId: award.studentId, definitionId: award.definitionId, reference: award.reference, via: award.awardedVia },
      { type: "diploma_award", id: award.id },
    );
    events.audit({
      action: via === "FORCED" ? "higher.award.forced" : "higher.award.created",
      resourceType: "diploma_award",
      resourceId: award.id,
      sensitive: true,
      reason: forcedReason,
      after: { reference: award.reference, definitionId: award.definitionId, studentId: award.studentId, via: award.awardedVia, creditsTotal: award.creditsTotal, mentionCode: award.mentionCode, predecessorAwardId: award.predecessorAwardId },
    });
    await events.flush(tx);
    return ok({ status: "AWARDED", award });
  });
}

export interface RevokeAwardInput {
  readonly awardId: Uuid;
  /** Motif obligatoire (≥ 10 caractères). */
  readonly reason: string;
}

/** Révocation : terminale ; les documents émis passent `REVOKED` dans la même transaction (déclencheur). */
export async function revokeAward(deps: HigherDeps, ctx: RequestContext, input: RevokeAwardInput): Promise<Result<DiplomaAward, AppError>> {
  const reason = input.reason.trim();
  if (reason.length < REVOKE_REASON_MIN) return err(validation(HigherCode.REVOKE_REASON_REQUIRED, `Le motif de révocation doit faire au moins ${REVOKE_REASON_MIN} caractères.`, "reason"));
  if (!ctx.userId) return err(validation(HigherCode.INVALID_INPUT, "Un utilisateur est requis pour révoquer un diplôme.", "userId"));
  const by = ctx.userId;
  const byName = await actorName(deps, ctx);
  return inTx(deps, ctx, async (tx) => {
    const current = await repo.getAward(tx, input.awardId, true);
    if (!current) return err(notFound(HigherCode.AWARD_NOT_FOUND, "Octroi", input.awardId));
    if (current.status === "REVOKED") return err(conflict(HigherCode.ALREADY_REVOKED, "Ce diplôme est déjà révoqué."));
    const revoked = await repo.revokeAward(tx, current.id, by, byName, reason, deps.clock.now());
    if (!revoked) return err(conflict(HigherCode.ALREADY_REVOKED, "Ce diplôme est déjà révoqué."));
    const events = new EventBuffer(deps, ctx);
    events.add(
      HigherEvents.DIPLOMA_REVOKED,
      { v: 1, awardId: revoked.id, studentId: revoked.studentId, definitionId: revoked.definitionId, reason },
      { type: "diploma_award", id: revoked.id },
    );
    events.audit({
      action: "higher.award.revoked",
      resourceType: "diploma_award",
      resourceId: revoked.id,
      sensitive: true,
      reason,
      before: { status: "OBTAINED", reference: current.reference },
      after: { status: "REVOKED", documentsRevoked: (await docs.listDocumentsOfAward(tx, revoked.id)).filter((d) => d.status === "REVOKED").length },
    });
    await events.flush(tx);
    return ok(revoked);
  });
}

export async function getAward(deps: HigherDeps, ctx: RequestContext, awardId: Uuid): Promise<Result<DiplomaAward, AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const a = await repo.getAward(tx, awardId);
      return a ? ok(a) : err(notFound(HigherCode.AWARD_NOT_FOUND, "Octroi", awardId));
    },
    { readOnly: true },
  );
}

export async function listAwards(
  deps: HigherDeps,
  ctx: RequestContext,
  f: { definitionId?: Uuid | undefined; studentId?: Uuid | undefined; status?: DiplomaAward["status"] | undefined; limit?: number | undefined; cursor?: string | undefined } = {},
): Promise<Result<{ items: DiplomaAward[]; nextCursor: string | null }, AppError>> {
  return inTx(deps, ctx, async (tx) => ok(await repo.listAwards(tx, f)), { readOnly: true });
}

export interface RecomputeReport {
  readonly evaluated: number;
  readonly awarded: number;
  readonly skipped: Readonly<Record<string, number>>;
  readonly failed: number;
}

/**
 * Évalue les diplômes ACTIFS qui exigent `ueNodeId` pour `studentId` (abonné `higher.credits.capitalized`, isolé de la
 * capitalisation : sa défaillance ne l'annule jamais, AC5.2). Une transaction PAR définition.
 */
export async function evaluateStudentDiplomas(deps: HigherDeps, ctx: RequestContext, input: { studentId: Uuid; ueNodeId: Uuid }): Promise<Result<RecomputeReport, AppError>> {
  const defs = await deps.db.run(ctx, (tx) => repo.listActiveDefinitionsRequiringUe(tx, input.ueNodeId), { readOnly: true });
  const skipped: Record<string, number> = {};
  let awarded = 0;
  for (const def of defs) {
    const r = await awardDiploma(deps, ctx, { definitionId: def.id, studentId: input.studentId, via: "AUTO" });
    if (!r.ok) return r; // transitoire ou règle indisponible : le worker rejoue (reprises puis dead-letter)
    if (r.value.status === "AWARDED") awarded += 1;
    else skipped[r.value.reason] = (skipped[r.value.reason] ?? 0) + 1;
  }
  return ok({ evaluated: defs.length, awarded, skipped, failed: 0 });
}

/** `POST /diplomas/:id/recompute` : réévaluation de masse (octroi automatique pour les étudiants éligibles du cycle). */
export async function recomputeDiploma(deps: HigherDeps, ctx: RequestContext, definitionId: Uuid): Promise<Result<RecomputeReport, AppError>> {
  const def = await deps.db.run(ctx, (tx) => repo.getDefinition(tx, definitionId), { readOnly: true });
  if (!def) return err(notFound(HigherCode.DIPLOMA_NOT_FOUND, "Diplôme", definitionId));
  const enrollments = await deps.ports.enrollments.listCycleEnrollments(ctx, def.curriculumNodeId);
  const students = [...new Set(enrollments.map((e) => e.studentId))];
  const skipped: Record<string, number> = {};
  let awarded = 0;
  let failed = 0;
  for (const studentId of students) {
    const r = await awardDiploma(deps, ctx, { definitionId, studentId, via: "AUTO" });
    if (!r.ok) {
      failed += 1;
      deps.logger.warn({ code: r.error.code, definitionId, studentId }, "higher : réévaluation en échec pour un étudiant");
      continue;
    }
    if (r.value.status === "AWARDED") awarded += 1;
    else skipped[r.value.reason] = (skipped[r.value.reason] ?? 0) + 1;
  }
  return ok({ evaluated: students.length, awarded, skipped, failed });
}

/** Diplômes d'un étudiant : octrois et progression vers les définitions actives de son cycle. */
export async function listStudentAwards(deps: HigherDeps, ctx: RequestContext, studentId: Uuid): Promise<Result<DiplomaAward[], AppError>> {
  return inTx(deps, ctx, async (tx) => ok(await repo.listAwardsOfStudent(tx, studentId)), { readOnly: true });
}
