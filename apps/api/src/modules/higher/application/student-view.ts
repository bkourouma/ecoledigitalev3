/**
 * Vues « Mon parcours » (étudiant, tuteur, secrétariat) : crédits acquis, dettes, rattrapages, diplômes et progression.
 * Lecture seule ; l'accès (soi-même, tuteur lié, personnel habilité) est décidé par la couche HTTP avant l'appel.
 */
import { ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import { isCurrentlyValid } from "../domain/credits";
import { toEligibilityContext, type DiplomaProgress } from "../domain/diploma";
import type { DiplomaAward, DiplomaDefinition, LedgerEntry, UeDebt, Uuid } from "../domain/types";
import * as diplomas from "../infrastructure/diplomas-repository";
import * as ledger from "../infrastructure/ledger-repository";
import * as resitRepo from "../infrastructure/resit-repository";
import { summarize, type CreditSummary } from "./ledger";
import { loadStanding } from "./diplomas";
import { scopeOf } from "./awards";
import { inTx, todayOf, type HigherDeps } from "./deps";
import type { StudentResitView } from "./resit";

export interface StudentDiplomaProgress {
  readonly definition: DiplomaDefinition;
  readonly progress: DiplomaProgress;
  /** Éligibilité rendue par la règle (`null` si le RuleSet est indisponible : jamais une valeur supposée). */
  readonly eligible: boolean | null;
}

export interface StudentDiplomaView {
  readonly studentId: Uuid;
  readonly awards: readonly DiplomaAward[];
  readonly progress: readonly StudentDiplomaProgress[];
}

export interface StudentPathway {
  readonly studentId: Uuid;
  readonly summary: CreditSummary;
  readonly acquired: readonly LedgerEntry[];
  readonly debts: readonly UeDebt[];
  readonly resits: readonly StudentResitView[];
  readonly diplomas: StudentDiplomaView;
}

async function diplomaView(deps: HigherDeps, ctx: RequestContext, tx: Parameters<typeof diplomas.getAward>[0], studentId: Uuid, acquiredUeIds: readonly Uuid[]): Promise<StudentDiplomaView> {
  const awards = await diplomas.listAwardsOfStudent(tx, studentId);
  const awardedDefs = new Set(awards.filter((a) => a.status === "OBTAINED").map((a) => a.definitionId));
  const defs = await diplomas.listActiveDefinitionsRequiringAny(tx, acquiredUeIds);
  const progress: StudentDiplomaProgress[] = [];
  for (const def of defs) {
    const standing = await loadStanding(deps, tx, def, studentId);
    let eligible: boolean | null = null;
    if (!awardedDefs.has(def.id)) {
      const r = await deps.ports.rules.evaluateEligibility(ctx, { exigences: toEligibilityContext(standing.states), uvRequises: def.uvRequired, scope: scopeOf(deps, def) });
      eligible = r.ok ? r.value.eligible : null;
    } else eligible = true;
    progress.push({ definition: def, progress: standing.progress, eligible });
  }
  return { studentId, awards, progress };
}

export async function getStudentDiplomaView(deps: HigherDeps, ctx: RequestContext, studentId: Uuid): Promise<Result<StudentDiplomaView, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const today = todayOf(deps);
    const acquired = (await ledger.listAcquiredForStudent(tx, studentId)).filter((e) => isCurrentlyValid(e, today));
    return ok(await diplomaView(deps, ctx, tx, studentId, acquired.map((e) => e.ueNodeId)));
  });
}

export async function getStudentPathway(deps: HigherDeps, ctx: RequestContext, studentId: Uuid): Promise<Result<StudentPathway, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const today = todayOf(deps);
    const acquired = (await ledger.listAcquiredForStudent(tx, studentId)).filter((e) => isCurrentlyValid(e, today));
    const debts = await ledger.listOpenDebts(tx, studentId);
    const rows = await resitRepo.listRegistrationsOfStudent(tx, studentId);
    const resits: StudentResitView[] = rows.map((r) => ({ ...r, phase: r.outcome === "VALIDATED" ? "VALIDATED" : r.outcome === "NOT_VALIDATED" ? "NOT_VALIDATED" : "TO_RETAKE" }));
    return ok({
      studentId,
      summary: summarize(studentId, acquired, debts),
      acquired,
      debts,
      resits,
      diplomas: await diplomaView(deps, ctx, tx, studentId, acquired.map((e) => e.ueNodeId)),
    });
  });
}
