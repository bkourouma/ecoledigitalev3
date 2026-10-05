/**
 * Consommateurs d'événements (abonnés du worker, `subscribers.ts`). Idempotents par CONSTRUCTION : un rejeu ne retrouve plus de
 * candidat vivant pour l'inscription retirée.
 *
 *  - `academic.enrollment.withdrawn` : un élève qui quitte l'établissement avant la fin de l'examen est RETIRÉ de ses candidatures
 *    (motif tracé, numéro conservé, jamais réattribué). Une fois les résultats saisis, le retrait est impossible (base) : le candidat
 *    reste, le résultat aussi ; l'événement est alors ignoré pour lui.
 */
import { err, createSystemContext, ok, type AppError, type Result } from "@ecoledigitale/kernel";
import { examinationsConsumedEnrollmentWithdrawnSchema } from "@ecoledigitale/contracts/src/v2/examinations";
import { ExaminationsEvents } from "../domain/events";
import { ExamCode, validation } from "../domain/errors";
import * as cand from "../infrastructure/candidates-repo";
import * as sess from "../infrastructure/sessions-repo";
import { ASSIGNMENT_OPEN } from "../domain/lifecycle";
import { attempt, EventBuffer, inTx, type ExaminationsDeps } from "./deps";

export interface ConsumeReport {
  affected: number;
  ignored?: string;
}

export const AUTOMATIC_WITHDRAWAL_REASON = "Inscription scolaire retirée : retrait automatique de l'examen.";

export async function onEnrollmentWithdrawn(deps: ExaminationsDeps, tenantId: string, payload: unknown): Promise<Result<ConsumeReport, AppError>> {
  const parsed = examinationsConsumedEnrollmentWithdrawnSchema.safeParse(payload);
  if (!parsed.success) return err(validation(ExamCode.INVALID_INPUT, "Charge de l'événement d'inscription retirée illisible.", "payload"));
  const ctx = createSystemContext(tenantId);
  return inTx(deps, ctx, async (tx) => {
    const live = await cand.listCandidatesOfEnrollment(tx, parsed.data.enrollmentId);
    if (live.length === 0) return ok({ affected: 0, ignored: "aucune candidature vivante pour cette inscription" });
    const events = new EventBuffer(deps, ctx);
    let affected = 0;
    for (const c of live) {
      const r = await attempt(tx, async (inner) => {
        const s = await sess.getSession(inner, c.sessionId);
        if (!s) return ok(false);
        const withdrawn = await cand.withdrawCandidate(inner, c.id, AUTOMATIC_WITHDRAWAL_REASON);
        if (!withdrawn) return ok(false);
        if (ASSIGNMENT_OPEN.includes(s.status)) await sess.deleteAssignment(inner, c.id);
        events.add(ExaminationsEvents.CANDIDATE_WITHDRAWN, { v: 1, sessionId: c.sessionId, candidateId: c.id, studentId: c.studentId, candidateKind: c.candidateKind, reasonCode: "ENROLLMENT_WITHDRAWN" }, { type: "examinations.candidate", id: c.id });
        return ok(true);
      });
      // Retrait refusé par la base (résultats déjà saisis) : le candidat est conservé, ce n'est pas une erreur du consommateur.
      if (r.ok && r.value) affected += 1;
    }
    await events.flush(tx);
    return ok({ affected });
  });
}
