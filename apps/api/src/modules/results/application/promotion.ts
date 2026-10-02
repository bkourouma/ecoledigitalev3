/**
 * Décisions de PASSAGE de fin d'année, lues par `academic` (reconduction annuelle) : `results` répond, academic ne calcule rien.
 *
 *  1. une décision de fin d'année CONFIRMÉE (`scope = YEAR`, statut CONFIRMED ou PUBLISHED) donne le passage (`PROMOTED` /
 *     `ADMITTED`) ou le redoublement (`REPEAT`) — contrat à coefficients (décision du conseil de classe) ;
 *  2. à défaut, contrat à crédits : l'année est VALIDÉE quand chacune de ses périodes requises a un résultat FINAL validé
 *     (règle du jeu de règles, jamais recalculée ici) -> passage. Une année non validée n'a PAS de décision : la direction
 *     tranche (redoublement, passage avec dettes d'UE…) en enregistrant l'issue de l'inscription ;
 *  3. rien d'autre n'est deviné : une inscription sans décision confirmée est simplement omise.
 */
import { ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { Tx } from "@ecoledigitale/database";
import { outcomeOf } from "../domain/catalog";
import type { ResultHeader } from "../domain/records";
import { listYearEndDecisions } from "../infrastructure/governance-repository";
import { listFinalPeriodHeadersOfEnrollments } from "../infrastructure/results-repository";
import { inTx, type ResultsDeps } from "./deps";

export interface PromotionOutcome {
  readonly enrollmentId: string;
  readonly kind: "ADVANCE" | "REPEAT";
  /** Code de la décision (traçabilité) : code final confirmé, ou `YEAR_VALIDATED`. */
  readonly code: string;
}

const CREDIT_CONTRACT_PREFIX = "credit-";

export async function listPromotionOutcomes(
  deps: ResultsDeps,
  ctx: RequestContext,
  input: { academicYearId: string; enrollmentIds: readonly string[] },
): Promise<Result<PromotionOutcome[], AppError>> {
  if (input.enrollmentIds.length === 0) return ok([]);
  return inTx(
    deps,
    ctx,
    async (tx: Tx) => {
      const out = new Map<string, PromotionOutcome>();
      for (const d of await listYearEndDecisions(tx, input.academicYearId, input.enrollmentIds)) {
        const outcome = outcomeOf(d.finalCode);
        if (outcome === "PROMOTED" || outcome === "ADMITTED") out.set(d.enrollmentId, { enrollmentId: d.enrollmentId, kind: "ADVANCE", code: d.finalCode });
        else if (outcome === "REPEAT") out.set(d.enrollmentId, { enrollmentId: d.enrollmentId, kind: "REPEAT", code: d.finalCode });
      }
      const pending = input.enrollmentIds.filter((id) => !out.has(id));
      if (pending.length === 0) return ok([...out.values()]);

      const headers = await listFinalPeriodHeadersOfEnrollments(tx, input.academicYearId, pending);
      const byEnrollment = new Map<string, ResultHeader[]>();
      for (const h of headers) byEnrollment.set(h.enrollmentId, [...(byEnrollment.get(h.enrollmentId) ?? []), h]);
      // Périodes requises : une lecture du curriculum par classe (jamais par élève).
      const requiredByClassroom = new Map<string, readonly string[] | null>();
      for (const [, list] of byEnrollment) {
        const any = list[0] as ResultHeader;
        if (!any.contractId.startsWith(CREDIT_CONTRACT_PREFIX) || requiredByClassroom.has(any.classroomId) || any.academicPeriodId === null) continue;
        const structure = await deps.ports.curriculum.getStructure(ctx, { classroomId: any.classroomId, academicPeriodId: any.academicPeriodId });
        requiredByClassroom.set(any.classroomId, structure ? structure.yearPeriods.map((p) => p.id) : null);
      }
      for (const [enrollmentId, list] of byEnrollment) {
        const any = list[0] as ResultHeader;
        if (!any.contractId.startsWith(CREDIT_CONTRACT_PREFIX)) continue;
        const required = requiredByClassroom.get(any.classroomId);
        if (!required || required.length === 0) continue;
        const finals = new Map(list.map((h) => [h.academicPeriodId, h]));
        const complete = required.every((periodId) => finals.has(periodId));
        if (complete && required.every((periodId) => finals.get(periodId)?.validated === true)) out.set(enrollmentId, { enrollmentId, kind: "ADVANCE", code: "YEAR_VALIDATED" });
      }
      return ok([...out.values()]);
    },
    { readOnly: true },
  );
}
