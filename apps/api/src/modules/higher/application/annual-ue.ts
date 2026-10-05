/**
 * UE annuelle (décision O-11) : une UE offerte sur deux semestres (ou plus), avec UN résultat commun.
 *
 * Mécanisme (aucune règle officielle ici) :
 *  - la direction DÉCLARE une UE annuelle (`declareAnnualUe`) : la lignée « ancre » (identité au registre de crédits, aux
 *    prérequis et aux exigences de diplôme), les lignées qui l'alimentent (une par semestre, ou la même) et le nombre de
 *    semestres attendus ;
 *  - à la clôture de chaque semestre, `capitalizePeriod` NE capitalise PAS la partie : il l'enregistre (`annual_ue_parts`) ;
 *  - quand TOUS les semestres attendus ont un résultat FINAL, le port des règles évalue le résultat COMMUN (RuleSet :
 *    moyenne commune, crédits, validation, état LMD, session) et l'UE annuelle suit alors la capitalisation ORDINAIRE
 *    (une écriture au registre sous l'ancre, dettes, événements, révocation si le résultat est remplacé) ;
 *  - sans déclaration, rien ne change (parité avec le comportement d'origine).
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import { isUniqueViolation, type Tx } from "@ecoledigitale/database";
import { ANNUAL_UE_MAX_PARTS, ANNUAL_UE_MIN_PARTS, commonLine, foldAnnualUes, isComplete, latestPart, resitExhausted, type AnnualPart, type AnnualUeDef } from "../domain/annual-ue";
import { isoDateOf } from "../domain/credits";
import { HigherCode, conflict, notFound, validation } from "../domain/errors";
import type { Uuid } from "../domain/types";
import * as repo from "../infrastructure/annual-ue-repository";
import { EventBuffer, inTx, lockKey, todayOf, type HigherDeps } from "./deps";
import type { UeResultLine } from "./ports";

export interface DeclareAnnualUeInput {
  /** Lignée « ancre » : identité de l'UE annuelle (registre de crédits, prérequis, exigences de diplôme). */
  readonly ueNodeId: Uuid;
  /** Autres lignées qui alimentent l'UE (la partie du second semestre…). L'ancre en fait partie d'office. */
  readonly memberNodeIds?: readonly Uuid[] | undefined;
  /** Nombre de semestres attendus (2 par défaut, 4 au plus). */
  readonly partsExpected?: number | undefined;
  /** Motif (5 caractères au moins) : la déclaration change le calcul des résultats, elle est tracée. */
  readonly reason: string;
}

export async function declareAnnualUe(deps: HigherDeps, ctx: RequestContext, input: DeclareAnnualUeInput): Promise<Result<AnnualUeDef, AppError>> {
  const parts = input.partsExpected ?? ANNUAL_UE_MIN_PARTS;
  if (!Number.isInteger(parts) || parts < ANNUAL_UE_MIN_PARTS || parts > ANNUAL_UE_MAX_PARTS) {
    return err(validation(HigherCode.INVALID_INPUT, `Une UE annuelle s'étend sur ${ANNUAL_UE_MIN_PARTS} à ${ANNUAL_UE_MAX_PARTS} semestres.`, "partsExpected"));
  }
  const reason = input.reason?.trim() ?? "";
  if (reason.length < 5) return err(validation(HigherCode.INVALID_INPUT, "Un motif de 5 caractères minimum est requis.", "reason"));
  const members = [...new Set([input.ueNodeId, ...(input.memberNodeIds ?? [])])];
  for (const nodeId of members) {
    const ue = await deps.ports.curriculum.getUe(ctx, nodeId);
    if (!ue) return err(notFound(HigherCode.ANNUAL_UE_UNKNOWN_UE, "UE du curriculum", nodeId));
  }
  return inTx(deps, ctx, async (tx) => {
    for (const nodeId of members) {
      const taken = await repo.getDefOfMember(tx, nodeId);
      if (taken) {
        return err(
          taken.ueNodeId === input.ueNodeId
            ? conflict(HigherCode.ANNUAL_UE_EXISTS, "Cette UE est déjà déclarée annuelle.", { annualUeId: taken.id })
            : conflict(HigherCode.ANNUAL_UE_MEMBER_TAKEN, "Une des UE alimente déjà une autre UE annuelle.", { annualUeId: taken.id, ueNodeId: nodeId }),
        );
      }
    }
    const id = deps.newId();
    try {
      await tx.transaction(async (t) => {
        await repo.insertDef(t, { id, tenantId: ctx.tenantId, ueNodeId: input.ueNodeId, partsExpected: parts, reason, createdBy: ctx.userId, at: deps.clock.now() });
        for (const nodeId of members) await repo.insertMember(t, ctx.tenantId, id, nodeId);
      });
    } catch (e) {
      if (isUniqueViolation(e)) return err(conflict(HigherCode.ANNUAL_UE_EXISTS, "Cette UE est déjà déclarée annuelle."));
      throw e;
    }
    const events = new EventBuffer(deps, ctx);
    events.audit({ action: "higher.annual_ue.declared", resourceType: "annual_ue", resourceId: id, sensitive: true, reason, after: { ueNodeId: input.ueNodeId, memberNodeIds: members, partsExpected: parts } });
    await events.flush(tx);
    return ok((await repo.getDef(tx, id)) as AnnualUeDef);
  });
}

export async function listAnnualUes(deps: HigherDeps, ctx: RequestContext): Promise<Result<AnnualUeDef[], AppError>> {
  return inTx(deps, ctx, async (tx) => ok(await repo.listDefs(tx)), { readOnly: true });
}

/** Retire une déclaration — seulement tant qu'AUCUN résultat de semestre n'a été reçu (sinon l'historique du calcul serait orphelin). */
export async function removeAnnualUe(deps: HigherDeps, ctx: RequestContext, input: { id: Uuid; reason: string }): Promise<Result<{ removed: true }, AppError>> {
  const reason = input.reason?.trim() ?? "";
  if (reason.length < 5) return err(validation(HigherCode.INVALID_INPUT, "Un motif de 5 caractères minimum est requis.", "reason"));
  return inTx(deps, ctx, async (tx) => {
    const def = await repo.getDef(tx, input.id);
    if (!def) return err(notFound(HigherCode.ANNUAL_UE_NOT_FOUND, "UE annuelle", input.id));
    if ((await repo.countParts(tx, def.id)) > 0) return err(conflict(HigherCode.ANNUAL_UE_IN_USE, "Des résultats de semestre sont déjà enregistrés pour cette UE annuelle : elle ne peut plus être retirée."));
    await repo.deleteDef(tx, def.id);
    const events = new EventBuffer(deps, ctx);
    events.audit({ action: "higher.annual_ue.removed", resourceType: "annual_ue", resourceId: def.id, sensitive: true, reason, before: { ueNodeId: def.ueNodeId, memberNodeIds: def.memberNodeIds } });
    await events.flush(tx);
    return ok({ removed: true as const });
  });
}

// ---------------------------------------------------------------------------
// Capitalisation : résultat commun
// ---------------------------------------------------------------------------

export interface AnnualResolution {
  /** Lignes à capitaliser : lignes ordinaires inchangées + une ligne COMMUNE par UE annuelle complète. */
  readonly lines: readonly UeResultLine[];
  /** UE annuelles dont il manque encore au moins un semestre (rien n'est capitalisé, aucune dette). */
  readonly pending: number;
  /** Résultats communs évalués par les règles. */
  readonly evaluated: number;
}

const toPart = (line: UeResultLine, annualUeId: Uuid, now: Date): AnnualPart => ({
  annualUeId,
  studentId: line.studentId,
  enrollmentId: line.enrollmentId,
  academicYearId: line.academicYearId,
  academicPeriodId: line.academicPeriodId,
  partUeNodeId: line.ueNodeId,
  credits: line.credits,
  averageExact: line.averageExact,
  validated: line.validated,
  ueState: line.ueState,
  sessionObtained: line.sessionObtained,
  via: line.via,
  overrideId: line.overrideId,
  compensatedEcueCount: line.compensatedEcueCount,
  sourceResultId: line.sourceResultId,
  resultsVersion: line.resultsVersion,
  validatedAt: line.validatedAt ?? null,
  recordedAt: now,
});

/**
 * Remplace, dans les lignes d'une clôture, celles qui alimentent une UE annuelle : enregistre la partie, puis — si tous les
 * semestres attendus sont reçus — évalue le résultat commun par les RÈGLES. Appelé DANS la transaction de capitalisation
 * (même schéma que l'octroi : l'évaluation de règles est un appel de lecture). Une erreur de règle annule l'ensemble
 * (échec fermé : rien n'est capitalisé « de travers »).
 */
export async function resolveAnnualLines(
  deps: HigherDeps,
  ctx: RequestContext,
  tx: Tx,
  lines: readonly UeResultLine[],
  defs: readonly AnnualUeDef[],
): Promise<Result<AnnualResolution, AppError>> {
  const byMember = new Map<Uuid, AnnualUeDef>();
  for (const d of defs) for (const m of d.memberNodeIds) byMember.set(m, d);
  const ordinary: UeResultLine[] = [];
  const annual: Array<{ line: UeResultLine; def: AnnualUeDef }> = [];
  for (const l of lines) {
    const def = byMember.get(l.ueNodeId);
    if (def) annual.push({ line: l, def });
    else ordinary.push(l);
  }
  if (annual.length === 0) return ok({ lines: ordinary, pending: 0, evaluated: 0 });

  const now = deps.clock.now();
  // Ordre déterministe + verrou par (UE annuelle, étudiant) : deux clôtures de semestres concurrentes se sérialisent, la seconde voit la première.
  annual.sort((a, b) => a.def.id.localeCompare(b.def.id) || a.line.studentId.localeCompare(b.line.studentId) || a.line.academicPeriodId.localeCompare(b.line.academicPeriodId));
  const groups = new Map<string, { def: AnnualUeDef; studentId: Uuid; yearId: Uuid }>();
  for (const { line, def } of annual) {
    await lockKey(tx, ctx, "annual-ue", `${def.id}:${line.studentId}`);
    await repo.upsertPart(tx, ctx.tenantId, deps.newId(), toPart(line, def.id, now), now);
    groups.set(`${def.id}|${line.studentId}|${line.academicYearId}`, { def, studentId: line.studentId, yearId: line.academicYearId });
  }

  const out: UeResultLine[] = [...ordinary];
  let pending = 0;
  let evaluated = 0;
  for (const { def, studentId, yearId } of groups.values()) {
    const parts = await repo.listParts(tx, def.id, studentId, yearId);
    if (!isComplete(def, parts)) {
      pending += 1;
      continue;
    }
    const last = latestPart(parts);
    const juryValidated = parts.every((p) => p.via === "JURY_OVERRIDE" && p.overrideId !== null && p.validated);
    const evaluation = await deps.ports.rules.evaluateAnnualUe(ctx, {
      parts: parts.map((p) => ({ moyenne: p.averageExact, credits: p.credits, validationManuelle: p.via === "JURY_OVERRIDE", session: p.validated ? p.sessionObtained : null })),
      session2Tentee: resitExhausted(parts),
      validationParJury: juryValidated,
      scope: { curriculumNodeId: def.ueNodeId, onDate: last.validatedAt ? isoDateOf(last.validatedAt) : todayOf(deps) },
    });
    if (!evaluation.ok) return evaluation;
    const v = evaluation.value;
    out.push(commonLine(def, parts, { average: v.average, credits: v.credits, validated: v.validated, state: v.state, sessionObtained: v.sessionObtained }));
    evaluated += 1;
  }
  return ok({ lines: out, pending, evaluated });
}

/** Définitions déclarées (lecture seule), pour replier les UE d'un cycle ou d'un programme. */
export async function foldCurriculumUes<T extends { nodeId: Uuid; credits: number }>(deps: HigherDeps, ctx: RequestContext, ues: readonly T[]): Promise<T[]> {
  const defs = await deps.db.run(ctx, (tx) => repo.listDefs(tx), { readOnly: true });
  return foldAnnualUes(ues, defs);
}
