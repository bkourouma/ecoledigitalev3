/**
 * finance -> reportcards : `LearnerStandingPort` — « l'élève a-t-il un impayé exigible ? », sans montant ni détail.
 * Alimente l'option `reportcard.block-unpaid` ; sans ce port, l'option échoue FERMÉ (aucun bulletin communiqué à tort).
 */
import { hasOverdueBalance, type FinanceDeps } from "../../modules/finance";
import type { LearnerStandingPort } from "../../modules/reportcards";

export function createReportcardsLearnerStanding(finance: FinanceDeps): LearnerStandingPort {
  return {
    async hasOutstandingBalance(ctx, studentId) {
      const r = await hasOverdueBalance(finance, ctx, studentId);
      // Une lecture impossible n'autorise rien : l'erreur remonte (échec fermé côté reportcards).
      if (!r.ok) throw r.error;
      return r.value;
    },
  };
}
